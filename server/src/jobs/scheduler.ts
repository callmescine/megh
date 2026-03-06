import cron from 'node-cron';
import { reapExpiredSessions } from './session-reaper.js';
import { syncUsage } from './usage-sync.js';
import { generateInvoices } from './invoice-generator.js';

/**
 * Initialize all scheduled jobs.
 *
 * Schedule overview:
 *   - Session reaper:    every 5 minutes
 *   - Usage sync:        every hour (top of the hour)
 *   - Invoice generator: 1st of every month at midnight
 */
export function initScheduler(): void {
  console.log('[Scheduler] Initializing scheduled jobs…');

  // Reap expired sessions every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[Scheduler] Running session reaper');
    try {
      await reapExpiredSessions();
    } catch (err) {
      console.error('[Scheduler] Session reaper failed:', (err as Error).message);
    }
  });

  // Sync usage counters from Redis to Postgres every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running usage sync');
    try {
      await syncUsage();
    } catch (err) {
      console.error('[Scheduler] Usage sync failed:', (err as Error).message);
    }
  });

  // Generate invoices on the 1st of every month at midnight
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Scheduler] Running invoice generator');
    try {
      await generateInvoices();
    } catch (err) {
      console.error('[Scheduler] Invoice generation failed:', (err as Error).message);
    }
  });

  console.log('[Scheduler] All jobs scheduled');
}
