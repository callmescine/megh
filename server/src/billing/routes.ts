import { Router, Request, Response, raw } from 'express';
import Stripe from 'stripe';
import { getConfig } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { validate, TopupSchema } from '../validation.js';
import {
  createCheckoutSession,
  handleCheckoutCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  isConfigured as isStripeConfigured,
} from './stripe-service.js';
import {
  isConfigured as isRazorpayConfigured,
  handlePaymentLinkPaid,
  handleInvoicePaid as handleRazorpayInvoicePaid,
  handlePaymentFailed as handleRazorpayPaymentFailed,
  verifyWebhook as verifyRazorpayWebhook,
} from './razorpay-service.js';
import {
  getBalance,
  getUsageHistory,
  getSessionUsage,
  getMonthlyTotal,
} from './usage-service.js';
import {
  getAvailableProviders,
  getUserProvider,
  setUserProvider,
} from './provider-registry.js';
import { query } from '../db/connection.js';
import type { ProviderName } from './payment-provider.js';

// --- Billing API Router (JSON body, auth required) ---

export const billingRouter = Router();

billingRouter.use(requireAuth);

billingRouter.get('/balance', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const balance = await getBalance(userId);
    const monthlyTotal = await getMonthlyTotal(userId);

    // Get user's currency preference
    const userResult = await query(
      'SELECT payment_provider FROM users WHERE id = $1',
      [userId]
    );
    const provider = userResult.rows[0]?.payment_provider || 'stripe';
    const currency = provider === 'razorpay' ? 'INR' : 'USD';
    const config = getConfig();
    const exchangeRate = config.billing.exchange_rates?.[currency] || 1;

    res.json({
      ...balance,
      monthly_total: monthlyTotal,
      // Currency-converted display values
      currency,
      balance_display: currency === 'USD' ? balance.balance_usd : balance.balance_usd * exchangeRate,
      monthly_total_display: currency === 'USD' ? monthlyTotal : monthlyTotal * exchangeRate,
      exchange_rate: exchangeRate,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.get('/usage', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;
    const sessionId = req.query.session_id as string | undefined;

    const result = await getUsageHistory(userId, { page, limit, from, to, sessionId });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.get('/usage/:session_id', async (req: Request, res: Response) => {
  try {
    const result = await getSessionUsage(req.params.session_id as string);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.post('/topup', validate(TopupSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { amount, currency, provider: preferredProvider } = req.body;

    // If a specific provider is requested, use it; otherwise use user's default
    if (preferredProvider) {
      const available = getAvailableProviders();
      if (!available.includes(preferredProvider)) {
        res.status(400).json({ error: `Provider '${preferredProvider}' is not available` });
        return;
      }
      const { getProvider } = await import('./provider-registry.js');
      const providerInstance = getProvider(preferredProvider);
      const result = await providerInstance.createCheckoutSession(
        userId,
        amount,
        currency || 'USD'
      );
      res.json({ url: result.url });
      return;
    }

    // Use user's configured provider
    const providerInstance = await getUserProvider(userId);
    const checkoutCurrency = currency || (providerInstance.name === 'razorpay' ? 'INR' : 'USD');
    const result = await providerInstance.createCheckoutSession(userId, amount, checkoutCurrency);
    res.json({ url: result.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.get('/invoices', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Fetch from DB (covers both providers)
    const dbInvoices = await query(
      `SELECT id, user_id, stripe_invoice_id, razorpay_invoice_id, amount_usd, currency, status, provider, period_start, period_end, paid_at, created_at
       FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    // Also fetch from Stripe API for hosted URLs if Stripe is configured
    let stripeInvoiceMap: Record<string, any> = {};
    if (isStripeConfigured()) {
      const userResult = await query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [userId]
      );
      const customerId = userResult.rows[0]?.stripe_customer_id;
      if (customerId) {
        try {
          const config = getConfig();
          const stripe = new Stripe(config.billing.stripe_secret_key!);
          const stripeInvoices = await stripe.invoices.list({
            customer: customerId,
            limit: 50,
          });
          for (const inv of stripeInvoices.data) {
            stripeInvoiceMap[inv.id] = inv;
          }
        } catch {
          // Non-critical — continue with DB data
        }
      }
    }

    const invoices = dbInvoices.rows.map((row: any) => {
      const stripeData = row.stripe_invoice_id ? stripeInvoiceMap[row.stripe_invoice_id] : null;
      return {
        id: row.id,
        provider: row.provider || 'stripe',
        amount_due: stripeData?.amount_due ?? Math.round((row.amount_usd || 0) * 100),
        amount_paid: stripeData?.amount_paid ?? (row.status === 'paid' ? Math.round((row.amount_usd || 0) * 100) : 0),
        currency: stripeData?.currency || row.currency?.toLowerCase() || 'usd',
        status: row.status,
        created: stripeData?.created ?? Math.floor(new Date(row.created_at).getTime() / 1000),
        hosted_invoice_url: stripeData?.hosted_invoice_url || null,
        invoice_pdf: stripeData?.invoice_pdf || null,
      };
    });

    // If DB has no rows but Stripe has invoices, include Stripe-only ones
    if (dbInvoices.rows.length === 0 && Object.keys(stripeInvoiceMap).length > 0) {
      const stripeOnly = Object.values(stripeInvoiceMap).map((inv: any) => ({
        id: inv.id,
        provider: 'stripe',
        amount_due: inv.amount_due,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      }));
      res.json({ invoices: stripeOnly });
      return;
    }

    res.json({ invoices });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Provider management endpoints ---

billingRouter.get('/providers', async (_req: Request, res: Response) => {
  try {
    const available = getAvailableProviders();
    const config = getConfig();
    res.json({
      providers: available,
      default_currency: config.billing.default_currency,
      supported_currencies: config.billing.supported_currencies,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.put('/provider', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { provider } = req.body;

    if (!provider || !['stripe', 'razorpay'].includes(provider)) {
      res.status(400).json({ error: 'Invalid provider. Must be "stripe" or "razorpay".' });
      return;
    }

    await setUserProvider(userId, provider as ProviderName);
    res.json({ provider });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

billingRouter.get('/provider', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const provider = await getUserProvider(userId);
    res.json({ provider: provider.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Stripe Webhook Router (raw body, no auth) ---

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  '/',
  raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const config = getConfig();
    const stripe = new Stripe(config.billing.stripe_secret_key!);
    const sig = req.headers['stripe-signature'] as string;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        config.billing.stripe_webhook_secret!
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
      return;
    }

    // Idempotency check
    try {
      const existing = await query(
        'SELECT event_id FROM webhook_events WHERE event_id = $1',
        [event.id]
      );
      if (existing.rows.length > 0) {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
    } catch {
      // Table might not exist yet, proceed anyway
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          console.log(`Unhandled Stripe event type: ${event.type}`);
      }

      // Record event as processed
      try {
        await query(
          'INSERT INTO webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING',
          [event.id, event.type]
        );
      } catch {
        // Non-critical
      }

      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error(`Error handling Stripe event ${event.type}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// --- Razorpay Webhook Router (raw body, no auth) ---

export const razorpayWebhookRouter = Router();

razorpayWebhookRouter.post(
  '/',
  raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const sig = req.headers['x-razorpay-signature'] as string;

    let event: any;

    try {
      event = verifyRazorpayWebhook(req.body, sig);
    } catch (err: any) {
      console.error('Razorpay webhook signature verification failed:', err.message);
      res.status(400).json({ error: `Webhook Error: ${err.message}` });
      return;
    }

    const eventId = event.event || `rp_${Date.now()}`;

    // Idempotency check
    try {
      const existing = await query(
        'SELECT event_id FROM webhook_events WHERE event_id = $1',
        [eventId]
      );
      if (existing.rows.length > 0) {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
    } catch {
      // Table might not exist yet
    }

    try {
      switch (event.event) {
        case 'payment_link.paid':
          await handlePaymentLinkPaid(event);
          break;

        case 'invoice.paid':
          await handleRazorpayInvoicePaid(event);
          break;

        case 'payment.failed':
          await handleRazorpayPaymentFailed(event);
          break;

        default:
          console.log(`Unhandled Razorpay event type: ${event.event}`);
      }

      // Record event as processed
      try {
        await query(
          'INSERT INTO webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING',
          [eventId, event.event]
        );
      } catch {
        // Non-critical
      }

      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error(`Error handling Razorpay event ${event.event}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  }
);
