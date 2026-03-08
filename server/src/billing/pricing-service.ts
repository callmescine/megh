import { query } from '../db/connection.js';

export interface PricingConfig {
  id: string;
  tier: string;
  pricing_model: 'per_hour' | 'per_session' | 'token_markup';
  price_per_hour: number;
  price_per_session: number;
  token_markup_multiplier: number;
  currency: string;
  active: boolean;
}

export async function getActivePricing(tier: string = 'default', currency: string = 'USD'): Promise<PricingConfig | null> {
  // Try exact tier + currency match first
  const result = await query(
    `SELECT * FROM pricing_config WHERE tier = $1 AND currency = $2 AND active = true ORDER BY created_at DESC LIMIT 1`,
    [tier, currency],
  );

  if (result.rows.length > 0) {
    return result.rows[0] as PricingConfig;
  }

  // Fall back to default tier with same currency
  if (tier !== 'default') {
    const defaultResult = await query(
      `SELECT * FROM pricing_config WHERE tier = 'default' AND currency = $1 AND active = true ORDER BY created_at DESC LIMIT 1`,
      [currency],
    );
    if (defaultResult.rows.length > 0) {
      return defaultResult.rows[0] as PricingConfig;
    }
  }

  // Final fallback: any active pricing for this tier (ignoring currency)
  const fallback = await query(
    `SELECT * FROM pricing_config WHERE tier = $1 AND active = true ORDER BY created_at DESC LIMIT 1`,
    [tier === 'default' ? 'default' : tier],
  );

  return fallback.rows.length > 0 ? (fallback.rows[0] as PricingConfig) : null;
}

export async function getEstimatedCost(ttlMinutes: number, tier: string = 'default', currency: string = 'USD'): Promise<{
  estimated_cost: number;
  pricing_model: string;
  currency: string;
  pricing: PricingConfig | null;
}> {
  const pricing = await getActivePricing(tier, currency);

  if (!pricing) {
    return { estimated_cost: 0, pricing_model: 'none', currency, pricing: null };
  }

  let estimatedCost = 0;

  switch (pricing.pricing_model) {
    case 'per_hour':
      estimatedCost = pricing.price_per_hour * (ttlMinutes / 60);
      break;
    case 'per_session':
      estimatedCost = pricing.price_per_session;
      break;
    case 'token_markup':
      // Token markup is applied per-usage, not upfront
      estimatedCost = 0;
      break;
  }

  return {
    estimated_cost: Math.round(estimatedCost * 100) / 100,
    pricing_model: pricing.pricing_model,
    currency: pricing.currency || currency,
    pricing,
  };
}
