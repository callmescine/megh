import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password must be at most 128 characters'),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const CreateSessionSchema = z.object({
  ttl_minutes: z.number().int().min(5).max(480).optional(),
  ttlMinutes: z.number().int().min(5).max(480).optional(),
});

export const TopupSchema = z.object({
  amount: z.number().min(5, 'Minimum top-up is $5').max(500, 'Maximum top-up is $500'),
});

export const WsTicketSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const UpdateUserSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned']).optional(),
  tier: z.enum(['free_trial', 'prepaid', 'postpaid']).optional(),
  role: z.enum(['user', 'admin']).optional(),
  balance_adjustment: z.number().optional(),
});

export const PricingConfigSchema = z.object({
  tier: z.string().min(1).optional(),
  pricing_model: z.enum(['per_hour', 'per_session', 'token_markup']).optional(),
  price_per_hour: z.number().min(0).optional(),
  price_per_session: z.number().min(0).optional(),
  token_markup_multiplier: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

export const CustomDomainSchema = z.object({
  domain: z.string().min(3).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid domain format'),
});

export const PlatformSettingSchema = z.object({
  value: z.any(),
});

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------

export function validate(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }
    req.body = result.data;
    next();
  };
}
