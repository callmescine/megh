import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { query } from '../db/connection.js';
import { getConfig } from '../config.js';
import { pingDocker } from '../sessions/container-manager.js';
import { getRedis } from '../db/redis.js';
import { verifyDomain, generateNginxConfig } from './domain-service.js';
import crypto from 'crypto';

export const adminRouter = Router();

// All admin routes require authentication + admin role
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      whereClause = `WHERE u.email ILIKE $${params.length}`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM users u ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count);

    const usersResult = await query(
      `SELECT u.id, u.email, u.tier, u.status, COALESCE(u.role, 'user') as role, u.created_at,
              b.balance_usd, b.current_month_usage
       FROM users u
       LEFT JOIN billing_accounts b ON b.user_id = u.id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({ users: usersResult.rows, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const userResult = await query(
      `SELECT u.id, u.email, u.tier, u.status, COALESCE(u.role, 'user') as role, u.created_at,
              b.balance_usd, b.billing_tier, b.monthly_limit_usd, b.current_month_usage
       FROM users u
       LEFT JOIN billing_accounts b ON b.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id],
    );

    if (userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const sessionsResult = await query(
      `SELECT id, status, ttl_minutes, started_at, expires_at, destroyed_at
       FROM sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [req.params.id],
    );

    res.json({ user: userResult.rows[0], sessions: sessionsResult.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.patch('/users/:id', async (req: Request, res: Response) => {
  try {
    const { status, tier, role, balance_adjustment } = req.body;
    const userId = req.params.id;

    if (status) {
      await query('UPDATE users SET status = $1 WHERE id = $2', [status, userId]);
    }
    if (tier) {
      await query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
    }
    if (role) {
      await query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    }
    if (typeof balance_adjustment === 'number') {
      await query(
        'UPDATE billing_accounts SET balance_usd = balance_usd + $1 WHERE user_id = $2',
        [balance_adjustment, userId],
      );
    }

    res.json({ message: 'User updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

adminRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: any[] = [];

    if (status) {
      params.push(status);
      whereClause = `WHERE s.status = $${params.length}`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM sessions s ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count);

    const sessionsResult = await query(
      `SELECT s.*, u.email as user_email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ${whereClause}
       ORDER BY s.started_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({ sessions: sessionsResult.rows, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { destroySession } = await import('../sessions/session-service.js');
    await destroySession(req.params.id as string);
    res.json({ message: 'Session destroyed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Metrics / Overview
// ---------------------------------------------------------------------------

adminRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const usersCount = await query('SELECT COUNT(*) FROM users');
    const activeSessionsCount = await query("SELECT COUNT(*) FROM sessions WHERE status = 'active'");
    const todayRevenue = await query(
      "SELECT COALESCE(SUM(cost_usd), 0) as total FROM usage_events WHERE created_at >= CURRENT_DATE",
    );
    const totalRevenue = await query(
      'SELECT COALESCE(SUM(cost_usd), 0) as total FROM usage_events',
    );

    res.json({
      total_users: parseInt(usersCount.rows[0].count),
      active_sessions: parseInt(activeSessionsCount.rows[0].count),
      revenue_today: parseFloat(todayRevenue.rows[0].total),
      revenue_total: parseFloat(totalRevenue.rows[0].total),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Platform Settings
// ---------------------------------------------------------------------------

adminRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM platform_settings ORDER BY key');
    res.json({ settings: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/settings/:key', async (req: Request, res: Response) => {
  try {
    const { value } = req.body;
    await query(
      `INSERT INTO platform_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
      [req.params.key, JSON.stringify(value), req.user!.id],
    );
    res.json({ message: 'Setting updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

adminRouter.get('/pricing', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM pricing_config ORDER BY tier, created_at DESC');
    res.json({ pricing: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/pricing', async (req: Request, res: Response) => {
  try {
    const { tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, currency } = req.body;
    const result = await query(
      `INSERT INTO pricing_config (tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tier || 'default', pricing_model || 'per_hour', price_per_hour || 0, price_per_session || 0, token_markup_multiplier || 1.0, currency || 'USD'],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/pricing/:id', async (req: Request, res: Response) => {
  try {
    const { tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, active, currency } = req.body;
    const result = await query(
      `UPDATE pricing_config SET
         tier = COALESCE($1, tier),
         pricing_model = COALESCE($2, pricing_model),
         price_per_hour = COALESCE($3, price_per_hour),
         price_per_session = COALESCE($4, price_per_session),
         token_markup_multiplier = COALESCE($5, token_markup_multiplier),
         active = COALESCE($6, active),
         currency = COALESCE($7, currency),
         updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, active, currency, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pricing config not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Custom Domains
// ---------------------------------------------------------------------------

adminRouter.get('/domains', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM custom_domains ORDER BY created_at DESC');
    res.json({ domains: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/domains', async (req: Request, res: Response) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      res.status(400).json({ error: 'Domain is required' });
      return;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const result = await query(
      `INSERT INTO custom_domains (domain, verification_token)
       VALUES ($1, $2)
       RETURNING *`,
      [domain, verificationToken],
    );

    res.status(201).json({
      ...result.rows[0],
      verification_instructions: `Add a TXT record: _megh-verify.${domain} = ${verificationToken}`,
    });
  } catch (err: any) {
    if (err.message?.includes('duplicate')) {
      res.status(409).json({ error: 'Domain already exists' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/domains/:id/verify', async (req: Request, res: Response) => {
  try {
    const domainResult = await query(
      'SELECT * FROM custom_domains WHERE id = $1',
      [req.params.id],
    );

    if (domainResult.rows.length === 0) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }

    const domainRecord = domainResult.rows[0];
    await query(
      "UPDATE custom_domains SET status = 'verifying' WHERE id = $1",
      [req.params.id],
    );

    const verified = await verifyDomain(domainRecord.domain, domainRecord.verification_token);

    if (verified) {
      await query(
        "UPDATE custom_domains SET status = 'active', verified_at = NOW() WHERE id = $1",
        [req.params.id],
      );
      res.json({ status: 'active', message: 'Domain verified successfully' });
    } else {
      await query(
        "UPDATE custom_domains SET status = 'failed' WHERE id = $1",
        [req.params.id],
      );
      res.json({ status: 'failed', message: 'DNS verification failed. Check your TXT record.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.delete('/domains/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM custom_domains WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }
    res.json({ message: 'Domain removed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/domains/:id/nginx-config', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT domain, status FROM custom_domains WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Domain not found' });
      return;
    }
    const config = generateNginxConfig(result.rows[0].domain);
    res.json({ domain: result.rows[0].domain, nginx_config: config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Health (detailed)
// ---------------------------------------------------------------------------

adminRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const checks: Record<string, any> = {};

    try {
      const start = Date.now();
      await query('SELECT 1');
      checks.postgres = { status: 'ok', latency_ms: Date.now() - start };
    } catch (err: any) {
      checks.postgres = { status: 'fail', error: err.message };
    }

    try {
      const start = Date.now();
      const redis = getRedis();
      await redis.ping();
      checks.redis = { status: 'ok', latency_ms: Date.now() - start };
    } catch (err: any) {
      checks.redis = { status: 'fail', error: err.message };
    }

    try {
      const start = Date.now();
      await pingDocker();
      checks.docker = { status: 'ok', latency_ms: Date.now() - start };
    } catch (err: any) {
      checks.docker = { status: 'fail', error: err.message };
    }

    // Container creation queue stats
    try {
      const { getQueueStats } = await import('../sessions/container-queue.js');
      checks.container_queue = { status: 'ok', ...getQueueStats() };
    } catch {
      checks.container_queue = { status: 'ok', running: 0, queued: 0, maxConcurrency: 0 };
    }

    // Active sessions count
    try {
      const sessResult = await query(
        `SELECT COUNT(*)::int AS active FROM sessions WHERE status IN ('active', 'grace', 'provisioning')`,
      );
      const config = getConfig();
      checks.sessions = {
        status: 'ok',
        active: sessResult.rows[0].active,
        global_limit: config.containers.max_global_sessions,
      };
    } catch (err: any) {
      checks.sessions = { status: 'fail', error: err.message };
    }

    const allOk = Object.values(checks).every((c: any) => c.status === 'ok');

    res.json({
      status: allOk ? 'healthy' : 'degraded',
      checks,
      uptime: process.uptime(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
