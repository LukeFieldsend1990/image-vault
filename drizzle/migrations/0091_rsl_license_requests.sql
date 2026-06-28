-- RSL Open License Protocol (OLP) requests — Phase 2.
--
-- One row per machine-initiated request to license a talent's likeness for an
-- AI usage. Resolved through the talent's consent posture: red is rejected
-- before insert, green is auto-granted (standing instruction = always), amber
-- routes to the talent/agent for review. The license token attests consent;
-- metered billing still runs through royalty_sources / usage_events.
CREATE TABLE IF NOT EXISTS rsl_license_requests (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage TEXT NOT NULL,
  use_category_id TEXT NOT NULL,
  posture_light TEXT NOT NULL,
  client_id TEXT,
  client_name TEXT,
  contact_email TEXT,
  intended_use TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  decided_by TEXT REFERENCES users(id),
  decided_at INTEGER,
  license_token_hash TEXT UNIQUE,
  license_expires_at INTEGER,
  licence_id TEXT REFERENCES licences(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rsl_license_requests_talent ON rsl_license_requests(talent_id);
CREATE INDEX IF NOT EXISTS idx_rsl_license_requests_status ON rsl_license_requests(status);
