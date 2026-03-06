-- UP
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin'));

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier TEXT NOT NULL DEFAULT 'default',
  pricing_model TEXT NOT NULL DEFAULT 'per_hour' CHECK (pricing_model IN ('per_hour', 'per_session', 'token_markup')),
  price_per_hour NUMERIC(10, 4) DEFAULT 0,
  price_per_session NUMERIC(10, 4) DEFAULT 0,
  token_markup_multiplier NUMERIC(10, 4) DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'active', 'failed')),
  verification_token TEXT NOT NULL,
  ssl_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

-- DOWN
DROP TABLE IF EXISTS custom_domains;
DROP TABLE IF EXISTS pricing_config;
DROP TABLE IF EXISTS platform_settings;
ALTER TABLE users DROP COLUMN IF EXISTS role;
