-- Fix invites.role CHECK constraint to include industry and compliance.
--
-- 0006_invites.sql created invites with CHECK(role IN ('talent','rep','licensee')).
-- This predates the industry and compliance roles. D1 enforces CHECK constraints
-- on INSERT, so creating an invite with those roles fails with SQLITE_CONSTRAINT_CHECK.
--
-- SQLite cannot ALTER a CHECK constraint — the table must be recreated.
-- Strategy: rename old → create new → copy → drop old.
--
-- D1 has FK enforcement ON and blocks PRAGMA legacy_alter_table/foreign_keys.
-- However, the ONLY table referencing invites (production_cast.invite_id) has
-- 0 non-NULL values in production, so DROP TABLE invites_old will succeed:
-- D1 checks data rows that reference the dropped table, not just FK definitions.
--
-- NOTE: users.role has the same CHECK constraint issue but users cannot be
-- recreated via migration (45 child tables with real data reference it and
-- D1 blocks the PRAGMAs needed to disable FK enforcement during the drop).
-- The users.role constraint is worked around at the application layer in
-- the signup route (see app/api/auth/signup/route.ts).

ALTER TABLE invites RENAME TO invites_old;

CREATE TABLE invites (
  id            TEXT    PRIMARY KEY,
  email         TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK(role IN ('talent','rep','licensee','industry','compliance')),
  invited_by    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  talent_id     TEXT    REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT,
  used_at       INTEGER,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  production_id TEXT    REFERENCES productions(id),
  org_subtype   TEXT
);

INSERT INTO invites (
  id, email, role, invited_by, talent_id, message,
  used_at, expires_at, created_at, production_id, org_subtype
)
SELECT
  id, email, role, invited_by, talent_id, message,
  used_at, expires_at, created_at, production_id, org_subtype
FROM invites_old;

DROP TABLE invites_old;

CREATE INDEX IF NOT EXISTS idx_invites_created_at ON invites(created_at);
