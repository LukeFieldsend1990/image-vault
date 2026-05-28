-- Indexes for admin event log pages — eliminates full-table scans on ORDER BY timestamp
-- bridge_events is the hot table (can be spammed by misbehaving agents)
CREATE INDEX IF NOT EXISTS idx_bridge_events_created_at   ON bridge_events(created_at);
CREATE INDEX IF NOT EXISTS idx_bridge_events_severity     ON bridge_events(severity);
CREATE INDEX IF NOT EXISTS idx_bridge_grants_created_at   ON bridge_grants(created_at);
CREATE INDEX IF NOT EXISTS idx_download_events_started_at ON download_events(started_at);
CREATE INDEX IF NOT EXISTS idx_licences_created_at        ON licences(created_at);
CREATE INDEX IF NOT EXISTS idx_scan_packages_created_at   ON scan_packages(created_at);
CREATE INDEX IF NOT EXISTS idx_invites_created_at         ON invites(created_at);
CREATE INDEX IF NOT EXISTS idx_users_created_at           ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_pwreset_tokens_created_at  ON password_reset_tokens(created_at);
