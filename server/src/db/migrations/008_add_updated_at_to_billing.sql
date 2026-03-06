-- UP
ALTER TABLE billing_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- DOWN
ALTER TABLE billing_accounts DROP COLUMN IF EXISTS updated_at;
