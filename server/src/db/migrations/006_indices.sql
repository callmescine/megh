-- UP
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_usage_events_session_created ON usage_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON sessions(status, expires_at) WHERE status IN ('active', 'grace');

-- DOWN
-- DROP INDEX IF EXISTS idx_sessions_user_status;
-- DROP INDEX IF EXISTS idx_usage_events_session_created;
-- DROP INDEX IF EXISTS idx_sessions_status_expires;
