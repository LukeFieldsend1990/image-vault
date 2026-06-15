-- Fix role CHECK constraints on users and invites to include industry and compliance.
--
-- 0006_invites.sql created invites with CHECK(role IN ('talent','rep','licensee')).
-- 0000_auth.sql created users with CHECK(role IN ('talent','rep','licensee','admin')).
-- Both predate the industry and compliance roles. SQLite *does* enforce CHECK
-- constraints on INSERT, so creating an invite or account with those roles
-- throws a constraint violation at the DB layer.
--
-- SQLite cannot ALTER a CHECK constraint — the tables must be recreated.
-- D1 has PRAGMA foreign_keys = OFF by default, so DROP TABLE is safe.
--
-- Strategy: rename old → create new → copy → drop old (data is always present).

-- ── users ─────────────────────────────────────────────────────────────────────
ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  id                           TEXT    PRIMARY KEY,
  email                        TEXT    NOT NULL UNIQUE,
  password_hash                TEXT    NOT NULL,
  -- No CHECK constraint; role values are enforced at the TypeScript layer.
  role                         TEXT    NOT NULL DEFAULT 'talent',
  created_at                   INTEGER NOT NULL,
  vault_locked                 INTEGER NOT NULL DEFAULT 0,
  suspended_at                 INTEGER,
  phone                        TEXT,
  email_muted                  INTEGER NOT NULL DEFAULT 0,
  ai_disabled                  INTEGER NOT NULL DEFAULT 0,
  inbound_enabled              INTEGER NOT NULL DEFAULT 0,
  geo_fingerprint_enabled      INTEGER NOT NULL DEFAULT 0,
  royalty_meter_enabled        INTEGER NOT NULL DEFAULT 1,
  compliance_enabled           INTEGER NOT NULL DEFAULT 1,
  financial_visibility_enabled INTEGER NOT NULL DEFAULT 0,
  short_code                   TEXT,
  show_codes                   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users (
  id, email, password_hash, role, created_at,
  vault_locked, suspended_at, phone,
  email_muted, ai_disabled, inbound_enabled, geo_fingerprint_enabled,
  royalty_meter_enabled, compliance_enabled, financial_visibility_enabled,
  short_code, show_codes
)
SELECT
  id, email, password_hash, role, created_at,
  vault_locked, suspended_at, phone,
  email_muted, ai_disabled, inbound_enabled, geo_fingerprint_enabled,
  royalty_meter_enabled, compliance_enabled, financial_visibility_enabled,
  short_code, show_codes
FROM users_old;

DROP TABLE users_old;

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- ── invites ───────────────────────────────────────────────────────────────────
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
