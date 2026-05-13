-- Widen render_bridge_agents so agents are org-scoped (not per-production).
-- SQLite cannot ALTER COLUMN, so we recreate the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE render_bridge_agents_new (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  production_id TEXT REFERENCES productions(id),   -- now nullable
  display_name TEXT NOT NULL,
  service_token_hash TEXT,
  token_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  last_heartbeat_at INTEGER,
  published_packages_json TEXT NOT NULL DEFAULT '[]',
  pending_action TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

INSERT INTO render_bridge_agents_new
SELECT id, organisation_id, production_id, display_name, service_token_hash,
       token_expires_at, status, last_heartbeat_at, published_packages_json,
       pending_action, revoked_at, created_at
FROM render_bridge_agents;

DROP TABLE render_bridge_agents;

ALTER TABLE render_bridge_agents_new RENAME TO render_bridge_agents;

CREATE INDEX IF NOT EXISTS idx_rba_org ON render_bridge_agents(organisation_id);

PRAGMA foreign_keys=ON;
