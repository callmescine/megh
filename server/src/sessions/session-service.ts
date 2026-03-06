import { randomUUID, createHash } from 'crypto';
import { getConfig } from '../config.js';
import { getRedis, initSubscriber } from '../db/redis.js';
import { query, getPool } from '../db/connection.js';
import * as containerManager from './container-manager.js';
import { enqueue } from './container-queue.js';
import { getActivePricing } from '../billing/pricing-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  user_id: string;
  container_id: string;
  status: string;
  ttl_minutes: number;
  port_mappings: Record<number, number>;
  started_at: string;
  expires_at: string;
  destroyed_at: string | null;
  created_at: string;
}

export interface CreateSessionResult {
  sessionId: string;
  containerId: string;
  portMappings: Record<number, number>;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Advisory lock key — deterministic int from user ID for pg_advisory_xact_lock
// ---------------------------------------------------------------------------

function userLockKey(userId: string): number {
  const hash = createHash('md5').update(userId).digest();
  return hash.readInt32BE(0);
}

// ---------------------------------------------------------------------------
// createSession — protected by advisory lock, global cap, budget enforcement,
//                 and container creation queue
// ---------------------------------------------------------------------------

export async function createSession(
  userId: string,
  opts: { ttlMinutes?: number } = {},
): Promise<CreateSessionResult> {
  const config = getConfig();
  const redis = getRedis();
  const pool = getPool();

  // Use a dedicated client for the transaction so the advisory lock holds
  const client = await pool.connect();

  let sessionId: string;
  let ttlMinutes: number;

  try {
    await client.query('BEGIN');

    // Acquire advisory lock scoped to this user — prevents concurrent
    // session creation for the same user from racing past the count check.
    // Released automatically when the transaction ends.
    await client.query('SELECT pg_advisory_xact_lock($1)', [userLockKey(userId)]);

    // 1. Verify user is active
    const userResult = await client.query(
      'SELECT id, status FROM users WHERE id = $1',
      [userId],
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }
    if (userResult.rows[0].status !== 'active') {
      throw new Error(`User account is ${userResult.rows[0].status}`);
    }

    // 2. Check balance + monthly budget with FOR UPDATE lock
    const billingResult = await client.query(
      'SELECT balance_usd, monthly_limit_usd FROM billing_accounts WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    if (billingResult.rows.length === 0) {
      throw new Error('No billing account found');
    }

    const balance = parseFloat(billingResult.rows[0].balance_usd);
    const monthlyLimit = parseFloat(billingResult.rows[0].monthly_limit_usd || '0');

    // Calculate actual monthly usage from usage_events
    const usageResult = await client.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::numeric AS total
       FROM usage_events
       WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [userId],
    );
    const monthlyUsage = parseFloat(usageResult.rows[0].total);

    if (balance < config.containers.min_balance) {
      throw new Error(
        `Insufficient balance. Minimum $${config.containers.min_balance.toFixed(2)} required to start a session.`,
      );
    }

    // 3. Enforce monthly budget limit
    if (monthlyLimit > 0 && monthlyUsage >= monthlyLimit) {
      throw new Error(
        `Monthly spending limit ($${monthlyLimit.toFixed(2)}) reached. Usage this month: $${monthlyUsage.toFixed(2)}.`,
      );
    }

    // 4. Enforce per-user max concurrent sessions (under advisory lock — no race)
    const activeResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM sessions
       WHERE user_id = $1 AND status IN ('active', 'grace', 'provisioning')`,
      [userId],
    );

    const userActiveCount = activeResult.rows[0].count;
    if (userActiveCount >= config.containers.max_concurrent) {
      throw new Error(
        `Maximum concurrent sessions per user (${config.containers.max_concurrent}) reached.`,
      );
    }

    // 5. Enforce global max concurrent sessions
    const globalResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM sessions WHERE status IN ('active', 'grace', 'provisioning')`,
    );

    const globalActiveCount = globalResult.rows[0].count;
    if (globalActiveCount >= config.containers.max_global_sessions) {
      throw new Error(
        `Platform is at capacity (${config.containers.max_global_sessions} active sessions). Please try again later.`,
      );
    }

    // All pre-flight checks passed — reserve the slot
    sessionId = randomUUID();
    ttlMinutes = opts.ttlMinutes ?? config.containers.ttl_default;

    const ttlSeconds = ttlMinutes * 60;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Insert as 'provisioning' to hold the slot under the lock
    await client.query(
      `INSERT INTO sessions
         (id, user_id, container_id, status, ttl_minutes, port_mappings, started_at, expires_at)
       VALUES ($1, $2, 'pending', 'creating', $3, '{}', NOW(), $4)`,
      [sessionId, userId, ttlMinutes, expiresAt],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 6. Create & start container via the throttled queue
  //    Runs outside the transaction so we don't hold DB resources during Docker ops.
  let containerId: string;
  let portMappings: Record<number, number>;

  try {
    const result = await enqueue(async () => {
      const created = await containerManager.createContainer({
        sessionId,
        userId,
        proxyPort: config.proxy.port,
        ttlMinutes,
      });
      await containerManager.startContainer(created.containerId);
      return created;
    });

    containerId = result.containerId;
    portMappings = result.portMappings;
  } catch (err) {
    // Container creation failed — mark session as failed
    await query(
      `UPDATE sessions SET status = 'destroyed', destroyed_at = NOW() WHERE id = $1`,
      [sessionId],
    );
    throw err;
  }

  // 7. Set Redis keys
  const ttlSeconds = ttlMinutes * 60;
  await redis.set(`session:${sessionId}:status`, 'active');
  await redis.set(`session:${sessionId}:ttl`, '1', 'EX', ttlSeconds);
  await redis.set(`session:${sessionId}:user`, userId);

  // 8. Activate the session row with real container info
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await query(
    `UPDATE sessions
     SET container_id = $1, status = 'active', port_mappings = $2, expires_at = $3
     WHERE id = $4`,
    [containerId, JSON.stringify(portMappings), expiresAt, sessionId],
  );

  return { sessionId, containerId, portMappings, expiresAt };
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

export async function getSession(
  sessionId: string,
  userId: string,
): Promise<SessionRecord | null> {
  const result = await query(
    'SELECT * FROM sessions WHERE id = $1',
    [sessionId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = result.rows[0] as SessionRecord;

  // Verify ownership
  if (session.user_id !== userId) {
    return null;
  }

  return session;
}

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

export async function listSessions(
  userId: string,
  opts: { page?: number; limit?: number } = {},
): Promise<{ sessions: SessionRecord[]; total: number; page: number; limit: number }> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 50, 100);
  const offset = (page - 1) * limit;

  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1',
    [userId],
  );
  const total = countResult.rows[0].total;

  const result = await query(
    'SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset],
  );

  return {
    sessions: result.rows as SessionRecord[],
    total,
    page,
    limit,
  };
}

// ---------------------------------------------------------------------------
// chargeSessionUsage — bill for actual session time based on pricing config
// ---------------------------------------------------------------------------

async function chargeSessionUsage(session: SessionRecord): Promise<void> {
  const pricing = await getActivePricing('default');
  if (!pricing) return;

  const startedAt = new Date(session.started_at || session.created_at).getTime();
  const endedAt = Date.now();
  const durationMinutes = Math.max(1, (endedAt - startedAt) / (1000 * 60));

  let cost = 0;
  let description = '';

  switch (pricing.pricing_model) {
    case 'per_hour':
      cost = pricing.price_per_hour * (durationMinutes / 60);
      description = `Session ${session.id.slice(0, 8)} — ${Math.round(durationMinutes)}min @ $${pricing.price_per_hour}/hr`;
      break;
    case 'per_session':
      cost = pricing.price_per_session;
      description = `Session ${session.id.slice(0, 8)} — flat rate`;
      break;
    default:
      return;
  }

  cost = Math.round(cost * 10000) / 10000; // 4 decimal places
  if (cost <= 0) return;

  // Record usage event
  await query(
    `INSERT INTO usage_events (id, user_id, session_id, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, 0, 0, $5)`,
    [randomUUID(), session.user_id, session.id, 'session-time', cost],
  );

  // Deduct from balance
  await query(
    `UPDATE billing_accounts SET balance_usd = balance_usd - $1, updated_at = NOW() WHERE user_id = $2`,
    [cost, session.user_id],
  );

  // Invalidate Redis balance cache
  const redis = getRedis();
  await redis.del(`user:${session.user_id}:balance`, `user:${session.user_id}:balance_info`);

  console.log(`[Sessions] Charged $${cost.toFixed(4)} for ${description}`);
}

// ---------------------------------------------------------------------------
// endSession  — stop container, transition to grace period
// ---------------------------------------------------------------------------

export async function endSession(sessionId: string): Promise<void> {
  const config = getConfig();
  const redis = getRedis();

  const result = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);

  if (result.rows.length === 0) {
    throw new Error('Session not found');
  }

  const session = result.rows[0] as SessionRecord;

  // Stop the container (ignore errors if container is already gone)
  try {
    await containerManager.stopContainer(session.container_id);
  } catch (err: any) {
    console.warn(`[Sessions] Could not stop container for session ${sessionId}:`, err.message);
  }

  // Charge for actual session duration
  try {
    await chargeSessionUsage(session);
  } catch (err: any) {
    console.error(`[Sessions] Failed to charge for session ${sessionId}:`, err.message);
  }

  // Update status to grace
  await query(
    `UPDATE sessions SET status = 'grace' WHERE id = $1`,
    [sessionId],
  );

  // Set grace-period expiry key
  const gracePeriodSeconds = config.containers.grace_period * 60;
  await redis.set(`session:${sessionId}:grace`, '1', 'EX', gracePeriodSeconds);

  // Update the status key
  await redis.set(`session:${sessionId}:status`, 'grace');

  // Remove the TTL key (no longer needed)
  await redis.del(`session:${sessionId}:ttl`);
}

// ---------------------------------------------------------------------------
// destroySession  — fully remove container and clean up
// ---------------------------------------------------------------------------

export async function destroySession(sessionId: string): Promise<void> {
  const redis = getRedis();

  const result = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);

  if (result.rows.length === 0) {
    throw new Error('Session not found');
  }

  const session = result.rows[0] as SessionRecord;

  // Remove container (ignore errors if container is already gone)
  try {
    await containerManager.removeContainer(session.container_id);
  } catch (err: any) {
    console.warn(`[Sessions] Could not remove container for session ${sessionId}:`, err.message);
  }

  // Release all allocated ports
  const portMappings =
    typeof session.port_mappings === 'string'
      ? JSON.parse(session.port_mappings)
      : session.port_mappings;

  for (const hostPort of Object.values(portMappings) as number[]) {
    await containerManager.releasePort(hostPort);
  }

  // Delete Redis keys for this session
  await redis.del(
    `session:${sessionId}:status`,
    `session:${sessionId}:ttl`,
    `session:${sessionId}:grace`,
    `session:${sessionId}:user`,
    `session:${sessionId}:auth`,
  );

  // Update DB record
  await query(
    `UPDATE sessions SET status = 'destroyed', destroyed_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

// ---------------------------------------------------------------------------
// TTL subscriber  — listen for Redis key-expiry events
// ---------------------------------------------------------------------------

export async function initTTLSubscriber(): Promise<void> {
  const subscriber = await initSubscriber();

  subscriber.on('message', async (_channel: string, expiredKey: string) => {
    try {
      // Pattern: session:{id}:ttl  →  endSession
      const ttlMatch = expiredKey.match(/^session:(.+):ttl$/);
      if (ttlMatch) {
        const sessionId = ttlMatch[1];
        console.log(`[Sessions] TTL expired for session ${sessionId} — ending session`);
        await endSession(sessionId);
        return;
      }

      // Pattern: session:{id}:grace  →  destroySession
      const graceMatch = expiredKey.match(/^session:(.+):grace$/);
      if (graceMatch) {
        const sessionId = graceMatch[1];
        console.log(`[Sessions] Grace period expired for session ${sessionId} — destroying`);
        await destroySession(sessionId);
        return;
      }
    } catch (err) {
      console.error('[Sessions] Error handling key expiry:', expiredKey, err);
    }
  });

  console.log('[Sessions] TTL subscriber initialized');
}
