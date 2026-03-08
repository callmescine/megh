-- Add currency to pricing_config for per-currency pricing tiers
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD';

-- Seed default INR pricing: ₹49/hr
INSERT INTO pricing_config (tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, currency, active)
VALUES ('default', 'per_hour', 49.00, 0, 1.0, 'INR', true)
ON CONFLICT DO NOTHING;

-- Seed default USD pricing: $0.49/hr
INSERT INTO pricing_config (tier, pricing_model, price_per_hour, price_per_session, token_markup_multiplier, currency, active)
VALUES ('default', 'per_hour', 0.49, 0, 1.0, 'USD', true)
ON CONFLICT DO NOTHING;
