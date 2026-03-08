import { query } from '../db/connection.js';
import { createInvoice as createStripeInvoice, isConfigured as isStripeConfigured } from '../billing/stripe-service.js';
import { createInvoice as createRazorpayInvoice, isConfigured as isRazorpayConfigured } from '../billing/razorpay-service.js';

/**
 * Generate invoices for all postpaid users with outstanding usage.
 *
 * Runs on the 1st of every month at midnight.
 *   1. Skip if no payment providers are configured.
 *   2. Find all users on the 'postpaid' tier.
 *   3. For each user with usage > 0, create an invoice via their preferred provider.
 *   4. Reset current_month_usage to 0 after invoicing.
 */
export async function generateInvoices(): Promise<void> {
  if (!isStripeConfigured() && !isRazorpayConfigured()) {
    console.log('[InvoiceGenerator] No payment providers configured — skipping invoice generation');
    return;
  }

  // Find all postpaid users with their payment provider preference
  const usersResult = await query(
    `SELECT u.id, u.email, u.payment_provider, ba.current_month_usage
     FROM users u
     JOIN billing_accounts ba ON ba.user_id = u.id
     WHERE u.tier = 'postpaid'`,
  );

  let generated = 0;

  for (const user of usersResult.rows) {
    const usage = parseFloat(user.current_month_usage || '0');

    if (usage <= 0) {
      continue;
    }

    const provider = user.payment_provider || 'stripe';
    const description = `Monthly usage for ${user.email}`;

    try {
      if (provider === 'razorpay' && isRazorpayConfigured()) {
        await createRazorpayInvoice(user.id, usage, 'INR', description);
      } else if (isStripeConfigured()) {
        await createStripeInvoice(user.id, usage, description);
      } else {
        console.warn(
          `[InvoiceGenerator] Preferred provider '${provider}' not configured for user ${user.id}, skipping`
        );
        continue;
      }

      // Reset current month usage after successful invoice creation
      await query(
        `UPDATE billing_accounts
         SET current_month_usage = 0,
             updated_at = NOW()
         WHERE user_id = $1`,
        [user.id],
      );

      generated++;
      console.log(
        `[InvoiceGenerator] Created ${provider} invoice for user ${user.id} (${user.email}): $${usage.toFixed(2)}`,
      );
    } catch (err) {
      console.error(
        `[InvoiceGenerator] Failed to generate invoice for user ${user.id}:`,
        (err as Error).message,
      );
    }
  }

  console.log(`[InvoiceGenerator] Invoice generation complete: ${generated} invoice(s) created`);
}
