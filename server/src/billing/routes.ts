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
  isConfigured,
} from './stripe-service.js';
import {
  getBalance,
  getUsageHistory,
  getSessionUsage,
  getMonthlyTotal,
} from './usage-service.js';
import { query } from '../db/connection.js';

// --- Billing API Router (JSON body, auth required) ---

export const billingRouter = Router();

billingRouter.use(requireAuth);

billingRouter.get('/balance', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const balance = await getBalance(userId);
    const monthlyTotal = await getMonthlyTotal(userId);

    res.json({
      ...balance,
      monthly_total: monthlyTotal,
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
    const { amount } = req.body;

    const url = await createCheckoutSession(userId, amount);
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

billingRouter.get('/invoices', async (req: Request, res: Response) => {
  try {
    if (!isConfigured()) {
      res.json({ invoices: [] });
      return;
    }

    const userId = req.user!.id;
    const userResult = await query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    const customerId = userResult.rows[0]?.stripe_customer_id;

    if (!customerId) {
      res.json({ invoices: [] });
      return;
    }

    const config = getConfig();
    const stripe = new Stripe(config.billing.stripe_secret_key!);
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 50,
    });

    res.json({
      invoices: invoices.data.map((inv) => ({
        id: inv.id,
        amount_due: inv.amount_due,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      })),
    });
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

    // Idempotency check (1.10)
    try {
      const existing = await query(
        'SELECT event_id FROM webhook_events WHERE event_id = $1',
        [event.id]
      );
      if (existing.rows.length > 0) {
        // Already processed — return 200 without re-processing
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
          console.log(`Unhandled event type: ${event.type}`);
      }

      // Record event as processed (1.10)
      try {
        await query(
          'INSERT INTO webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING',
          [event.id, event.type]
        );
      } catch {
        // Non-critical — event was already processed
      }

      res.status(200).json({ received: true });
    } catch (err: any) {
      console.error(`Error handling event ${event.type}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  }
);
