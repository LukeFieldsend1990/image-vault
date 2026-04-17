-- Migration: 0033_placeholder_licences
--
-- Support placeholder licences: a licence can now be created with the deal
-- terms locked in before any scan package exists (e.g. actor is scanned on
-- day 3 of principal photography). Two changes, both requiring a table
-- rebuild because SQLite cannot alter NOT NULL or CHECK constraints in place:
--
--   1. package_id becomes nullable (was NOT NULL + FK to scan_packages)
--   2. status CHECK adds 'AWAITING_PACKAGE'
--
-- When a package is later attached, the licence auto-transitions to PENDING
-- and the normal approval flow resumes.

PRAGMA foreign_keys=OFF;

CREATE TABLE licences_new (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT REFERENCES scan_packages(id) ON DELETE CASCADE,
  licensee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  production_company TEXT NOT NULL,
  intended_use TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  file_scope TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('AWAITING_PACKAGE','PENDING','APPROVED','DENIED','REVOKED','EXPIRED')),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  denied_at INTEGER,
  denied_reason TEXT,
  revoked_at INTEGER,
  licence_type TEXT,
  territory TEXT,
  exclusivity TEXT DEFAULT 'non_exclusive',
  permit_ai_training INTEGER NOT NULL DEFAULT 0,
  proposed_fee INTEGER,
  agreed_fee INTEGER,
  platform_fee INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,
  delivery_mode TEXT NOT NULL DEFAULT 'standard',
  preauth_until INTEGER,
  preauth_set_by TEXT REFERENCES users(id),
  production_id TEXT REFERENCES productions(id),
  production_company_id TEXT REFERENCES production_companies(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO licences_new (
  id, talent_id, package_id, licensee_id, project_name, production_company,
  intended_use, valid_from, valid_to, file_scope, status, approved_by,
  approved_at, denied_at, denied_reason, revoked_at, licence_type, territory,
  exclusivity, permit_ai_training, proposed_fee, agreed_fee, platform_fee,
  download_count, last_download_at, delivery_mode, preauth_until, preauth_set_by,
  production_id, production_company_id, created_at
)
SELECT
  id, talent_id, package_id, licensee_id, project_name, production_company,
  intended_use, valid_from, valid_to, file_scope, status, approved_by,
  approved_at, denied_at, denied_reason, revoked_at, licence_type, territory,
  exclusivity, permit_ai_training, proposed_fee, agreed_fee, platform_fee,
  download_count, last_download_at, delivery_mode, preauth_until, preauth_set_by,
  production_id, production_company_id, created_at
FROM licences;

DROP TABLE licences;
ALTER TABLE licences_new RENAME TO licences;

CREATE INDEX IF NOT EXISTS idx_licences_talent   ON licences(talent_id);
CREATE INDEX IF NOT EXISTS idx_licences_licensee ON licences(licensee_id);
CREATE INDEX IF NOT EXISTS idx_licences_package  ON licences(package_id);
CREATE INDEX IF NOT EXISTS idx_licences_status   ON licences(status);

PRAGMA foreign_keys=ON;
