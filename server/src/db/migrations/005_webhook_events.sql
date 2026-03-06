-- UP
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DOWN
-- DROP TABLE IF EXISTS webhook_events;
