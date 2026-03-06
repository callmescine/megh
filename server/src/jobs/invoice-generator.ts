import { query } from '../db/connection.js';
import { createInvoice, isConfigured } from '../billing/stripe-service.js';

/**
 * Generate Stripe invoices for all postpaid users with outstanding usage.
 *
 * Runs on the 1st of every month at midnight.
 *   1. Skip if Stripe is not configured.
 *   2. Find all users on the 'postpaid' tier.
 *   3. For each user with usage > 0, create a Stripe invoice.
 *   4. Reset current_month_usage to 0 after invoicing.
 */
export async function generateInvoices(): Promise<void> {
  if (!isConfigured()) {
    console.log('[InvoiceGenerator] Stripe not configured — skipping invoice generation');
    return;
  }

  // Find all postpaid users
  const usersResult = await query(
    `SELECT u.id, u.email, ba.current_month_usage, ba.stripe_customer_id
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

    try {
      await createInvoice(user.id, usage, `Monthly usage for ${user.email}`);

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
        `[InvoiceGenerator] Created invoice for user ${user.id} (${user.email}): $${usage.toFixed(2)}`,
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
