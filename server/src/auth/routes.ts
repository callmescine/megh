import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { query } from '../db/connection.js';
import { signToken } from './jwt.js';
import { requireAuth } from './middleware.js';
import { getConfig } from '../config.js';
import { getRedis } from '../db/redis.js';
import { validate, RegisterSchema, LoginSchema, WsTicketSchema } from '../validation.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Rate limiters (1.2)
// ---------------------------------------------------------------------------

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  validate: { ip: false },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
  validate: { ip: false },
});

// ---------------------------------------------------------------------------
// Cookie helper (1.5)
// ---------------------------------------------------------------------------

function setAuthCookie(res: Response, token: string): void {
  const config = getConfig();
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('megh_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });

  // Set CSRF token as non-httpOnly cookie (1.6)
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('megh_csrf', csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('megh_token', { path: '/' });
  res.clearCookie('megh_csrf', { path: '/' });
}

// ---------------------------------------------------------------------------
// POST /register (1.3: generic error message)
// ---------------------------------------------------------------------------

authRouter.post('/register', registerLimiter, validate(RegisterSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    // Check email uniqueness — return generic error (1.3)
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(400).json({ error: 'Registration failed' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Detect if user is from India via timezone or Accept-Language
    const timezone = (req.headers['x-timezone'] as string) || '';
    const acceptLang = (req.headers['accept-language'] as string) || '';
    const isIndian = timezone.startsWith('Asia/Kolkata') ||
      timezone.startsWith('Asia/Calcutta') ||
      /\b(hi|hi-IN|en-IN)\b/i.test(acceptLang);

    const paymentProvider = isIndian ? 'razorpay' : 'stripe';

    const userResult = await query(
      `INSERT INTO users (email, password_hash, payment_provider)
       VALUES ($1, $2, $3)
       RETURNING id, email, tier, status, created_at`,
      [email, passwordHash, paymentProvider],
    );

    const user = userResult.rows[0];

    // Indian users get ₹99 (converted to USD), international users get $0.99
    const config = getConfig();
    const exchangeRate = config.billing.exchange_rates?.['INR'] || 83;
    const trialCreditsUsd = isIndian ? 99 / exchangeRate : 0.99;

    await query(
      `INSERT INTO billing_accounts (user_id, balance_usd)
       VALUES ($1, $2)`,
      [user.id, trialCreditsUsd],
    );

    const token = signToken(user.id, user.role || 'user');

    // Set httpOnly cookie (1.5)
    setAuthCookie(res, token);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        status: user.status,
        role: user.role || 'user',
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /login (1.3: fix suspension enumeration)
// ---------------------------------------------------------------------------

authRouter.post('/login', loginLimiter, validate(LoginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const result = await query(
      'SELECT id, email, password_hash, tier, status, COALESCE(role, \'user\') as role, created_at FROM users WHERE email = $1',
      [email],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Return same 401 for suspended users to prevent enumeration (1.3)
    if (user.status !== 'active') {
      console.warn(`[Auth] Login attempt for ${user.status} account: ${user.id}`);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signToken(user.id, user.role);

    // Set httpOnly cookie (1.5)
    setAuthCookie(res, token);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        status: user.status,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /refresh
// ---------------------------------------------------------------------------

authRouter.post('/refresh', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // Blacklist the old token to prevent reuse (token rotation)
    const oldToken = req.headers.authorization?.slice(7) || req.cookies?.megh_token;
    if (oldToken) {
      const redis = getRedis();
      const tokenHash = crypto.createHash('sha256').update(oldToken).digest('hex');
      await redis.set(`token:blacklist:${tokenHash}`, '1', 'EX', 86400); // 24h TTL
    }

    const token = signToken(user.id, user.role);

    setAuthCookie(res, token);

    res.json({ token });
  } catch (err) {
    console.error('[Auth] Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /logout (1.5)
// ---------------------------------------------------------------------------

authRouter.post('/logout', (_req: Request, res: Response): void => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

authRouter.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    const billingResult = await query(
      'SELECT balance_usd, billing_tier, monthly_limit_usd, current_month_usage FROM billing_accounts WHERE user_id = $1',
      [user.id],
    );

    const billing = billingResult.rows[0] || null;

    // Get user's payment provider preference for currency display
    const userResult = await query(
      'SELECT payment_provider FROM users WHERE id = $1',
      [user.id],
    );
    const paymentProvider = userResult.rows[0]?.payment_provider || 'stripe';
    const currency = paymentProvider === 'razorpay' ? 'INR' : 'USD';

    // Convert balance for display in user's currency
    const config = getConfig();
    const exchangeRate = config.billing.exchange_rates?.[currency] || 1;
    const balanceUsd = parseFloat(billing?.balance_usd ?? '0');
    const balanceDisplay = currency === 'USD' ? balanceUsd : balanceUsd * exchangeRate;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        status: user.status,
        role: user.role,
        payment_provider: paymentProvider,
        currency,
      },
      billing: billing ? {
        ...billing,
        balance_display: balanceDisplay,
        currency,
      } : null,
    });
  } catch (err) {
    console.error('[Auth] Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /ws-ticket — one-time WebSocket ticket (1.4)
// ---------------------------------------------------------------------------

authRouter.post('/ws-ticket', requireAuth, validate(WsTicketSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { sessionId } = req.body as { sessionId: string };

    const redis = getRedis();
    const ticket = crypto.randomBytes(64).toString('hex');

    // Store ticket in Redis with 30s TTL
    await redis.set(`ws-ticket:${ticket}`, `${user.id}:${sessionId}`, 'EX', 30);

    res.json({ ticket });
  } catch (err) {
    console.error('[Auth] WS ticket error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /forgot-password
// ---------------------------------------------------------------------------

authRouter.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    // Always return generic message to prevent email enumeration
    const genericMsg = { message: 'If an account with that email exists, a password reset link has been sent.' };

    if (!email) {
      res.json(genericMsg);
      return;
    }

    const result = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      res.json(genericMsg);
      return;
    }

    const userId = result.rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );

    // TODO: Send email with reset link containing the token
    // For now, log it (in production, integrate with email service)
    console.log(`[Auth] Password reset token for ${email}: ${token}`);

    res.json(genericMsg);
  } catch (err) {
    console.error('[Auth] Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /reset-password
// ---------------------------------------------------------------------------

authRouter.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };

    if (!token || !password || password.length < 8) {
      res.status(400).json({ error: 'Valid token and password (min 8 chars) are required' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const result = await query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const { user_id } = result.rows[0];
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user_id]);
    await query('UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1', [tokenHash]);

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('[Auth] Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
