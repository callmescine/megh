CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  stripe_customer_id VARCHAR(255),
  tier VARCHAR(20) DEFAULT 'free_trial' CHECK (tier IN ('free_trial','prepaid','postpaid')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','banned')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
