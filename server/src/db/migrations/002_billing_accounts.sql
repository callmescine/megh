CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance_usd DECIMAL(10,4) DEFAULT 0,
  billing_tier VARCHAR(20) DEFAULT 'trial',
  monthly_limit_usd DECIMAL(10,2) DEFAULT 50.00,
  current_month_usage DECIMAL(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
