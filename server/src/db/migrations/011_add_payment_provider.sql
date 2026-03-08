-- Add payment provider support (Razorpay integration)

-- User's preferred payment provider
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) DEFAULT 'stripe';

-- Razorpay customer ID alongside existing stripe_customer_id
ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_customer_id VARCHAR(255);

-- Track which provider created each invoice
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'stripe';

-- Razorpay invoice reference (stripe_invoice_id already exists for Stripe)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS razorpay_invoice_id VARCHAR(255);

-- Currency on invoices (default USD for backwards compat)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD';

-- Drop the unique constraint on stripe_invoice_id to allow NULLs for Razorpay invoices
-- and add a partial unique index instead
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_stripe_invoice_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_stripe_invoice_id_unique ON invoices (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_razorpay_invoice_id_unique ON invoices (razorpay_invoice_id) WHERE razorpay_invoice_id IS NOT NULL;
