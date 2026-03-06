CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  container_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'creating' CHECK (status IN ('creating','active','expiring','grace','destroyed')),
  ttl_minutes INTEGER NOT NULL,
  port_mappings JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  destroyed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
