import Razorpay from 'razorpay';
import crypto from 'crypto';
import { getConfig } from '../config.js';
import { query } from '../db/connection.js';
import { getRedis } from '../db/redis.js';
import type { PaymentProvider, CheckoutResult } from './payment-provider.js';

let razorpayInstance: InstanceType<typeof Razorpay> | null = null;

function getRazorpay(): InstanceType<typeof Razorpay> {
  const config = getConfig();
  if (!config.billing.razorpay_key_id || !config.billing.razorpay_key_secret) {
    throw new Error('Razorpay not configured');
  }
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: config.billing.razorpay_key_id,
      key_secret: config.billing.razorpay_key_secret,
    });
  }
  return razorpayInstance;
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!(config.billing.razorpay_key_id && config.billing.razorpay_key_secret);
}

export async function createCustomer(userId: string, email: string): Promise<string> {
  const rp = getRazorpay();

  const customer = await rp.customers.create({
    email,
    notes: { userId },
  } as any);

  await query(
    'UPDATE users SET razorpay_customer_id = $1 WHERE id = $2',
    [customer.id, userId]
  );

  return customer.id;
}

export async function createCheckoutSession(
  userId: string,
  amount: number,
  currency: string
): Promise<CheckoutResult> {
  const rp = getRazorpay();
  const config = getConfig();

  // Get or create Razorpay customer
  const userResult = await query(
    'SELECT email, razorpay_customer_id FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];

  let customerId = user.razorpay_customer_id;
  if (!customerId) {
    customerId = await createCustomer(userId, user.email);
  }

  const domain = config.platform.domain || 'localhost:3000';

  // Amount in smallest currency unit (paise for INR, cents for USD)
  const unitAmount = Math.round(amount * 100);

  const paymentLink = await rp.paymentLink.create({
    amount: unitAmount,
    currency: currency.toUpperCase(),
    description: 'Account Top-up',
    customer: {
      email: user.email,
    },
    notify: {
      email: true,
    },
    callback_url: `https://${domain}/billing?topup=success`,
    callback_method: 'get',
    notes: {
      userId,
    },
  } as any);

  return { url: paymentLink.short_url };
}

export async function handlePaymentLinkPaid(event: any): Promise<void> {
  const paymentLink = event.payload?.payment_link?.entity;
  const payment = event.payload?.payment?.entity;

  if (!paymentLink) return;

  const userId = paymentLink.notes?.userId;
  if (!userId) {
    throw new Error('No userId in payment link notes');
  }

  const currency = (payment?.currency || paymentLink.currency || 'INR').toUpperCase();
  const amountRaw = (payment?.amount || paymentLink.amount || 0) / 100;

  // Convert to USD if not already USD
  let amountUsd = amountRaw;
  if (currency !== 'USD') {
    const config = getConfig();
    const rate = config.billing.exchange_rates?.[currency] || 83; // default INR/USD
    amountUsd = amountRaw / rate;
  }

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

export async function handleInvoicePaid(event: any): Promise<void> {
  const invoice = event.payload?.invoice?.entity;
  if (!invoice?.id) return;

  const amountRaw = (invoice.amount_paid || invoice.amount || 0) / 100;
  const currency = (invoice.currency || 'INR').toUpperCase();
  const userId = invoice.notes?.userId || null;

  // If no userId in notes, try to find by customer_id
  let resolvedUserId = userId;
  if (!resolvedUserId && invoice.customer_id) {
    const userResult = await query(
      'SELECT id FROM users WHERE razorpay_customer_id = $1',
      [invoice.customer_id]
    );
    resolvedUserId = userResult.rows[0]?.id ?? null;
  }

  await query(
    `INSERT INTO invoices (user_id, razorpay_invoice_id, amount_usd, currency, status, provider, paid_at)
     VALUES ($1, $2, $3, $4, 'paid', 'razorpay', NOW())
     ON CONFLICT (razorpay_invoice_id)
     DO UPDATE SET status = 'paid', amount_usd = $3, paid_at = NOW()`,
    [resolvedUserId, invoice.id, amountRaw, currency]
  );
}

export async function handlePaymentFailed(event: any): Promise<void> {
  const payment = event.payload?.payment?.entity;
  if (!payment) return;

  const userId = payment.notes?.userId;
  if (userId) {
    await query(
      'UPDATE users SET status = $1 WHERE id = $2',
      ['suspended', userId]
    );
  }
}

export async function createInvoice(
  userId: string,
  amount: number,
  currency: string,
  description: string
): Promise<string> {
  const rp = getRazorpay();

  const userResult = await query(
    'SELECT email, razorpay_customer_id FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];

  let customerId = user?.razorpay_customer_id;
  if (!customerId) {
    customerId = await createCustomer(userId, user.email);
  }

  const unitAmount = Math.round(amount * 100);

  const invoice = await rp.invoices.create({
    type: 'invoice',
    customer_id: customerId,
    line_items: [
      {
        name: description,
        amount: unitAmount,
        currency: currency.toUpperCase(),
        quantity: 1,
      },
    ],
    email_notify: 1,
    notes: { userId },
  } as any);

  return invoice.id;
}

export function verifyWebhook(body: Buffer, signature: string): any {
  const config = getConfig();
  const secret = config.billing.razorpay_webhook_secret;
  if (!secret) {
    throw new Error('Razorpay webhook secret not configured');
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== signature) {
    throw new Error('Invalid webhook signature');
  }

  return JSON.parse(body.toString());
}

// PaymentProvider implementation
export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  isConfigured,
  createCustomer,
  createCheckoutSession,
  createInvoice,
  verifyWebhook,
};
