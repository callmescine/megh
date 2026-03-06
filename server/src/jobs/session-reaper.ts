import Docker from 'dockerode';
import { query } from '../db/connection.js';
import { endSession, destroySession } from '../sessions/session-service.js';
import { getConfig } from '../config.js';
import { getRedis } from '../db/redis.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Reap sessions that have exceeded their TTL or grace period.
 *
 * Three phases:
 *   0. Reconcile: re-create missing Redis keys from PostgreSQL state (2.6)
 *   1. End active sessions whose expires_at has passed.
 *   2. Destroy sessions in "grace" status whose grace period has elapsed.
 */
export async function reapExpiredSessions(): Promise<void> {
  const config = getConfig();
  const redis = getRedis();
  const gracePeriodMinutes = config.containers.grace_period;

  // -- Phase 0: Reconcile Redis from PostgreSQL (2.6) --
  try {
    const activeResult = await query(
      `SELECT id, user_id, status, expires_at FROM sessions
       WHERE status IN ('active', 'grace')`,
    );

    for (const session of activeResult.rows) {
      const statusKey = `session:${session.id}:status`;
      const exists = await redis.exists(statusKey);

      if (!exists) {
        console.log(`[SessionReaper] Reconciling missing Redis keys for session ${session.id}`);
        await redis.set(statusKey, session.status);
        await redis.set(`session:${session.id}:user`, session.user_id);

        if (session.status === 'active' && session.expires_at) {
          const ttlSeconds = Math.max(0, Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000));
          if (ttlSeconds > 0) {
            await redis.set(`session:${session.id}:ttl`, '1', 'EX', ttlSeconds);
          }
        } else if (session.status === 'grace') {
          const graceTtl = gracePeriodMinutes * 60;
          await redis.set(`session:${session.id}:grace`, '1', 'EX', graceTtl);
        }
      }
    }
  } catch (err) {
    console.error('[SessionReaper] Reconciliation failed:', (err as Error).message);
  }

  // -- Phase 0.5: Check container health (6.4) --
  try {
    const healthResult = await query(
      `SELECT id, container_id FROM sessions WHERE status = 'active' AND container_id IS NOT NULL`,
    );

    for (const session of healthResult.rows) {
      try {
        const container = docker.getContainer(session.container_id);
        const info = await container.inspect();
        const healthStatus = info.State?.Health?.Status;

        if (healthStatus === 'unhealthy') {
          console.log(`[SessionReaper] Container unhealthy for session ${session.id} — ending session`);
          await endSession(session.id);
        }
      } catch {
        // Container might not exist anymore — will be caught by Phase 1
      }
    }
  } catch (err) {
    console.error('[SessionReaper] Health check phase failed:', (err as Error).message);
  }

  // -- Phase 1: End expired active sessions --
  const expiredResult = await query(
    `SELECT id FROM sessions
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`,
  );

  if (expiredResult.rows.length > 0) {
    console.log(`[SessionReaper] Found ${expiredResult.rows.length} expired active session(s)`);
  }

  for (const session of expiredResult.rows) {
    try {
      await endSession(session.id);
      console.log(`[SessionReaper] Ended expired session ${session.id}`);
    } catch (err) {
      console.error(
        `[SessionReaper] Failed to end session ${session.id}:`,
        (err as Error).message,
      );
    }
  }

  // -- Phase 2: Destroy sessions past their grace period --
  const graceResult = await query(
    `SELECT id FROM sessions
     WHERE status = 'grace'
       AND destroyed_at IS NULL
       AND expires_at < NOW() - INTERVAL '${gracePeriodMinutes} minutes'`,
  );

  if (graceResult.rows.length > 0) {
    console.log(`[SessionReaper] Found ${graceResult.rows.length} session(s) past grace period`);
  }

  for (const session of graceResult.rows) {
    try {
      await destroySession(session.id);
      console.log(`[SessionReaper] Destroyed session ${session.id} (grace period elapsed)`);
    } catch (err) {
      console.error(
        `[SessionReaper] Failed to destroy session ${session.id}:`,
        (err as Error).message,
      );
    }
  }
}
