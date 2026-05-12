-- render_bridge_agents: headless Docker agents enrolled by organisations to publish
-- project-scoped package files to a facility render share.
CREATE TABLE IF NOT EXISTS render_bridge_agents (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  production_id TEXT NOT NULL REFERENCES productions(id),
  display_name TEXT NOT NULL,
  service_token_hash TEXT,          -- SHA-256 of plain svc_ token; null until first enrolment completes
  token_expires_at INTEGER,         -- unix timestamp
  status TEXT NOT NULL DEFAULT 'active',  -- active | revoked | expired
  last_heartbeat_at INTEGER,
  published_packages_json TEXT NOT NULL DEFAULT '[]',  -- JSON array of packageIds confirmed published
  pending_action TEXT,              -- null | purge | publish | rotate-token; cleared after heartbeat ack
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_render_bridge_agents_org
  ON render_bridge_agents(organisation_id);

CREATE INDEX IF NOT EXISTS idx_render_bridge_agents_production
  ON render_bridge_agents(production_id);
