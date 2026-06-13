-- Compliance role (Union / Regulator / Insurer "watchers").
--
-- Read-only role that receives compliance evidence for granted scopes only and
-- never reaches the data plane. The "compliance" value is added to users.role /
-- invites.role at the TS layer (SQLite does not enforce the enum), so only the
-- grants table needs DDL.
CREATE TABLE compliance_grants (
  id TEXT PRIMARY KEY,
  compliance_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtype TEXT NOT NULL,           -- union | regulator | insurer
  scope TEXT NOT NULL,             -- platform | organisation | production | talent
  scope_id TEXT,                   -- null = platform-wide
  granted_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_compliance_grants_user ON compliance_grants(compliance_user_id, revoked_at);
