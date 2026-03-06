import { query } from '../db/connection.js';
import { getRedis } from '../db/redis.js';

/**
 * Synchronize usage data from Redis to Postgres.
 *
 * For every active session's user:
 *   1. Read the real-time balance from Redis.
 *   2. Update the billing_accounts table with the current balance.
 *   3. Recalculate current_month_usage from this month's usage_events.
 */
export async function syncUsage(): Promise<void> {
  const redis = getRedis();

  // Get all active sessions with their associated user
  const sessionsResult = await query(
    `SELECT DISTINCT s.user_id
     FROM sessions s
     WHERE s.status = 'active'`,
  );

  const userIds: string[] = sessionsResult.rows.map((r) => r.user_id);

  if (userIds.length === 0) {
    console.log('[UsageSync] No active sessions — nothing to sync');
    return;
  }

  let synced = 0;
  let errors = 0;

  for (const userId of userIds) {
    try {
      // Read current balance from Redis
      const redisBalance = await redis.get(`user:${userId}:balance`);

      if (redisBalance !== null) {
        // Redis may contain a JSON object (from BalanceInfo cache) or a plain number
        let balance: number;
        try {
          const parsed = JSON.parse(redisBalance);
          balance = typeof parsed === 'object' && parsed !== null
            ? parseFloat(parsed.balance_usd)
            : parseFloat(redisBalance);
        } catch {
          balance = parseFloat(redisBalance);
        }

        // Guard against writing NaN to the database
        if (isNaN(balance)) {
          console.warn(`[UsageSync] Skipping NaN balance for user ${userId}, raw Redis value: ${redisBalance}`);
          continue;
        }

        // Update billing account balance
        await query(
          `UPDATE billing_accounts
           SET balance_usd = $1,
               updated_at = NOW()
           WHERE user_id = $2`,
          [balance, userId],
        );
      }

      // Recalculate current month usage from usage_events
      const usageResult = await query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM usage_events
         WHERE user_id = $1
           AND created_at >= DATE_TRUNC('month', NOW())`,
        [userId],
      );

      const monthUsage = parseFloat(usageResult.rows[0].total);

      await query(
        `UPDATE billing_accounts
         SET current_month_usage = $1,
             updated_at = NOW()
         WHERE user_id = $2`,
        [monthUsage, userId],
      );

      synced++;
    } catch (err) {
      errors++;
      console.error(
        `[UsageSync] Failed to sync usage for user ${userId}:`,
        (err as Error).message,
      );
    }
  }

  console.log(
    `[UsageSync] Sync complete: ${synced} user(s) synced, ${errors} error(s)`,
  );
}
