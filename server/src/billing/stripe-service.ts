import Stripe from 'stripe';
import { getConfig } from '../config.js';
import { query } from '../db/connection.js';
import { getRedis } from '../db/redis.js';

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  const config = getConfig();
  if (!config.billing.stripe_secret_key) {
    throw new Error('Stripe not configured');
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(config.billing.stripe_secret_key);
  }
  return stripeInstance;
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!config.billing.stripe_secret_key;
}

export async function createCustomer(userId: string, email: string): Promise<string> {
  const stripe = getStripe();

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  await query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, userId]
  );

  return customer.id;
}

export async function createCheckoutSession(userId: string, amountUsd: number): Promise<string> {
  const stripe = getStripe();
  const config = getConfig();

  // Get or create Stripe customer
  const userResult = await query(
    'SELECT email, stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    customerId = await createCustomer(userId, user.email);
  }

  const domain = config.platform.domain || 'localhost:3000';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Account Top-up',
          },
          unit_amount: Math.round(amountUsd * 100), // convert to cents
        },
        quantity: 1,
      },
    ],
    success_url: `https://${domain}/billing?topup=success`,
    cancel_url: `https://${domain}/billing?topup=cancelled`,
    metadata: {
      userId,
    },
  });

  return session.url!;
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  if (!userId) {
    throw new Error('No userId in checkout session metadata');
  }

  const amountUsd = (session.amount_total || 0) / 100; // convert cents to dollars

  await query(
    'UPDATE billing_accounts SET balance_usd = balance_usd + $1 WHERE user_id = $2',
    [amountUsd, userId]
  );

  // Update Redis balance cache
  const redis = getRedis();
  const balanceResult = await query(
    'SELECT balance_usd FROM billing_accounts WHERE user_id = $1',
    [userId]
  );
  if (balanceResult.rows.length > 0) {
    await redis.set(
      `user:${userId}:balance`,
      balanceResult.rows[0].balance_usd.toString(),
      'EX',
      300
    );
  }
}

export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return;

  const amountUsd = (invoice.amount_paid || 0) / 100;
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  // Find the user for this customer
  let userId: string | null = null;
  if (customerId) {
    const userResult = await query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId],
    );
    userId = userResult.rows[0]?.id ?? null;
  }

  // Upsert into invoices table
  await query(
    `INSERT INTO invoices (user_id, stripe_invoice_id, amount_usd, status, paid_at)
     VALUES ($1, $2, $3, 'paid', NOW())
     ON CONFLICT (stripe_invoice_id)
     DO UPDATE SET status = 'paid', amount_usd = $3, paid_at = NOW()`,
    [userId, invoice.id, amountUsd],
  );
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerEmail = invoice.customer_email;
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (customerId) {
    const userResult = await query(
      'SELECT id FROM users WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length > 0) {
      await query(
        'UPDATE users SET status = $1 WHERE id = $2',
        ['suspended', userResult.rows[0].id]
      );
    }
  }
}

export async function createInvoice(
  userId: string,
  amountUsd: number,
  description: string
): Promise<string> {
  const stripe = getStripe();

  const userResult = await query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );
  const customerId = userResult.rows[0]?.stripe_customer_id;
  if (!customerId) {
    throw new Error('User does not have a Stripe customer ID');
  }

  const invoice = await stripe.invoices.create({
    customer: customerId,
    auto_advance: false,
  });

  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id,
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    description,
  });

  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalizedInvoice.id);

  return finalizedInvoice.id;
}
