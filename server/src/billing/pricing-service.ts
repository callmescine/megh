import { query } from '../db/connection.js';

export interface PricingConfig {
  id: string;
  tier: string;
  pricing_model: 'per_hour' | 'per_session' | 'token_markup';
  price_per_hour: number;
  price_per_session: number;
  token_markup_multiplier: number;
  active: boolean;
}

export async function getActivePricing(tier: string = 'default'): Promise<PricingConfig | null> {
  const result = await query(
    `SELECT * FROM pricing_config WHERE tier = $1 AND active = true ORDER BY created_at DESC LIMIT 1`,
    [tier],
  );

  if (result.rows.length === 0) {
    // Fall back to default tier
    if (tier !== 'default') {
      return getActivePricing('default');
    }
    return null;
  }

  return result.rows[0] as PricingConfig;
}

export async function getEstimatedCost(ttlMinutes: number, tier: string = 'default'): Promise<{
  estimated_cost: number;
  pricing_model: string;
  pricing: PricingConfig | null;
}> {
  const pricing = await getActivePricing(tier);

  if (!pricing) {
    return { estimated_cost: 0, pricing_model: 'none', pricing: null };
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
    pricing,
  };
}
