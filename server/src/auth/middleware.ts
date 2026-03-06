import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyToken } from './jwt.js';
import { query } from '../db/connection.js';
import { getRedis } from '../db/redis.js';

export interface AuthUser {
  id: string;
  email: string;
  tier: string;
  status: string;
  role: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      id?: string; // Request ID for tracing
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Try Authorization header first, then fall back to httpOnly cookie (1.5)
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies?.megh_token) {
    token = req.cookies.megh_token;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    // Check token blacklist (refresh token rotation)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const redis = getRedis();
    const blacklisted = await redis.get(`token:blacklist:${tokenHash}`);
    if (blacklisted) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

    const { userId } = verifyToken(token);

    const result = await query(
      'SELECT id, email, tier, status, COALESCE(role, \'user\') as role FROM users WHERE id = $1',
      [userId],
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0] as AuthUser;

    if (user.status !== 'active') {
      res.status(401).json({ error: 'Account is not active' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---------------------------------------------------------------------------
// Admin middleware
// ---------------------------------------------------------------------------

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// CSRF protection middleware (1.6)
// Exempt: GET/HEAD/OPTIONS and paths starting with /webhooks
// ---------------------------------------------------------------------------

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Skip webhook endpoints (Stripe uses its own signature verification)
  if (req.path.startsWith('/webhooks')) {
    next();
    return;
  }

  const cookieToken = req.cookies?.megh_csrf;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    // Only enforce CSRF if user has a cookie-based session
    // If they're using Bearer token auth, CSRF is not needed
    if (req.cookies?.megh_token && !req.headers.authorization) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }
  }

  next();
}
