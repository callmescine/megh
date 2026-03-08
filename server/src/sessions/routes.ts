import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/middleware.js';
import {
  createSession,
  getSession,
  listSessions,
  endSession,
  destroySession,
} from './session-service.js';
import { validate, CreateSessionSchema } from '../validation.js';
import { getEstimatedCost } from '../billing/pricing-service.js';
import { getConfig } from '../config.js';
import { getQueueStats } from './container-queue.js';

export const sessionRouter = Router();

// All session routes require authentication
sessionRouter.use(requireAuth);

// GET /pricing — get cost estimate for session creation
sessionRouter.get('/pricing', async (req: Request, res: Response): Promise<void> => {
  try {
    const ttlMinutes = parseInt(req.query.ttl_minutes as string) || 60;
    const tier = req.user?.tier || 'default';
    // Get user's currency from payment provider preference
    const { query: dbQuery } = await import('../db/connection.js');
    const userResult = await dbQuery(
      'SELECT payment_provider FROM users WHERE id = $1',
      [req.user!.id]
    );
    const provider = userResult.rows[0]?.payment_provider || 'stripe';
    const currency = (req.query.currency as string) || (provider === 'razorpay' ? 'INR' : 'USD');
    const estimate = await getEstimatedCost(ttlMinutes, tier, currency);
    res.json(estimate);
  } catch (err) {
    console.error('[Sessions] Pricing error:', err);
    res.status(500).json({ error: 'Failed to get pricing' });
  }
});

// GET /queue-stats — current container creation queue status (for dashboard)
sessionRouter.get('/queue-stats', async (_req: Request, res: Response): Promise<void> => {
  res.json(getQueueStats());
});

// Rate limiter for session creation — keyed by user ID
const sessionCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: () => {
    try { return getConfig().containers.session_rate_limit; } catch { return 3; }
  },
  // All session routes sit behind requireAuth, so req.user.id is always set.
  // Using only user ID avoids the ipKeyGenerator requirement for IPv6.
  keyGenerator: (req: Request) => req.user?.id ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many session creation requests. Please wait a minute before trying again.' },
});

// POST / — create a new session
sessionRouter.post('/', sessionCreateLimiter, validate(CreateSessionSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { ttlMinutes?: number; ttl_minutes?: number };
    const ttlMinutes = body.ttlMinutes ?? body.ttl_minutes;
    const userId = req.user!.id;

    const session = await createSession(userId, { ttlMinutes });

    res.status(201).json({ id: session.sessionId, ...session });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sessions] Create error:', message);

    if (
      message.includes('Insufficient balance') ||
      message.includes('Maximum concurrent') ||
      message.includes('account is') ||
      message.includes('Monthly spending limit') ||
      message.includes('Platform is at capacity')
    ) {
      res.status(403).json({ error: message });
      return;
    }

    if (
      message.includes('Unable to reach Claude') ||
      message.includes('Authentication failed') ||
      message.includes('OAuth token is invalid') ||
      message.includes('API key is invalid') ||
      message.includes('Could not reach Anthropic') ||
      message.includes('Access denied')
    ) {
      res.status(502).json({ error: message });
      return;
    }

    if (message.includes('timed out') || message.includes('server is busy')) {
      res.status(503).json({ error: message });
      return;
    }

    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET / — list all sessions for the authenticated user (5.8: pagination)
sessionRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const result = await listSessions(userId, { page, limit });

    res.json(result);
  } catch (err) {
    console.error('[Sessions] List error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// GET /:id — get a single session's details
sessionRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const session = await getSession(req.params.id as string, userId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (err) {
    console.error('[Sessions] Get error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// DELETE /:id — end or destroy a session based on current status
sessionRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const session = await getSession(req.params.id as string, userId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'active') {
      await endSession(session.id);
      res.json({ message: 'Session ended — entering grace period' });
    } else if (session.status === 'grace') {
      await destroySession(session.id);
      res.json({ message: 'Session destroyed' });
    } else {
      res.status(400).json({ error: `Session is already ${session.status}` });
    }
  } catch (err) {
    console.error('[Sessions] Delete error:', err);
    res.status(500).json({ error: 'Failed to end session' });
  }
});
