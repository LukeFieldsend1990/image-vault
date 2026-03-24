-- Per-file SHA-256 for manifest verification
ALTER TABLE scan_files ADD COLUMN sha256 TEXT;

-- Delivery mode per licence: 'standard' (existing download flow) or 'bridge_only'
ALTER TABLE licences ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'standard';

-- Bridge API tokens (long-lived PATs stored hashed, like refresh tokens)
CREATE TABLE bridge_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  last_used_at  INTEGER,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

-- Bridge device registrations
CREATE TABLE bridge_devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  last_seen_at  INTEGER,
  created_at    INTEGER NOT NULL
);

-- Issued DCC grants — server-side record of every signed manifest
CREATE TABLE bridge_grants (
  id            TEXT PRIMARY KEY,
  licence_id    TEXT NOT NULL REFERENCES licences(id),
  package_id    TEXT NOT NULL REFERENCES scan_packages(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  tool          TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  manifest_json TEXT NOT NULL,
  signature     TEXT NOT NULL,
  key_id        TEXT NOT NULL DEFAULT 'bridge-signing-key-1',
  expires_at    INTEGER NOT NULL,
  offline_until INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

-- Bridge integrity events: tamper alerts, cache purges, open-denied, hash mismatches
CREATE TABLE bridge_events (
  id          TEXT PRIMARY KEY,
  grant_id    TEXT REFERENCES bridge_grants(id),
  package_id  TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  user_id     TEXT,
  event_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'warn',
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
