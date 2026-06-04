-- org_type on organisations (11 values, default production_company)
ALTER TABLE organisations ADD COLUMN org_type TEXT NOT NULL DEFAULT 'production_company';

-- productions: coordinator + SAG project number
ALTER TABLE productions ADD COLUMN coordinator_id TEXT REFERENCES users(id);
ALTER TABLE productions ADD COLUMN sag_project_number TEXT;

-- invites: production context (so post-signup can link back to cast row)
ALTER TABLE invites ADD COLUMN production_id TEXT REFERENCES productions(id);

-- production_cast: the core new table
CREATE TABLE IF NOT EXISTS production_cast (
  id                TEXT PRIMARY KEY,
  production_id     TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  talent_id         TEXT REFERENCES users(id),
  invite_id         TEXT REFERENCES invites(id),
  licence_id        TEXT REFERENCES licences(id),
  character_name    TEXT,
  department        TEXT,
  sag_member        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'invited',
  licence_terms_json TEXT,
  added_by          TEXT NOT NULL REFERENCES users(id),
  added_at          INTEGER NOT NULL,
  linked_at         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_production_cast_production_id ON production_cast(production_id);
CREATE INDEX IF NOT EXISTS idx_production_cast_talent_id ON production_cast(talent_id);
CREATE INDEX IF NOT EXISTS idx_production_cast_invite_id ON production_cast(invite_id);
CREATE INDEX IF NOT EXISTS idx_production_cast_licence_id ON production_cast(licence_id);
