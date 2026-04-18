-- Migration: 0035_scrub_attestations
--
-- Phase 3 wind-down: after a licence ends (revoked or expired), the licensee
-- has a fixed window to attest that all copies of the scan data have been
-- deleted from their systems. This migration:
--
--   1. Extends licences.status CHECK to include SCRUB_PERIOD, CLOSED, OVERDUE
--      (requires table rebuild — SQLite can't alter CHECK constraints)
--   2. Adds scrub_deadline + scrub_attested_at columns to licences
--   3. Creates scrub_attestations table (the formal declaration record)
--
-- Existing columns preserved through 0034 (contract_url et al.).

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
    CHECK (status IN ('AWAITING_PACKAGE','PENDING','APPROVED','DENIED','REVOKED','EXPIRED','SCRUB_PERIOD','CLOSED','OVERDUE')),
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
  contract_url TEXT,
  contract_uploaded_at INTEGER,
  contract_uploaded_by TEXT REFERENCES users(id),
  scrub_deadline INTEGER,
  scrub_attested_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO licences_new (
  id, talent_id, package_id, licensee_id, project_name, production_company,
  intended_use, valid_from, valid_to, file_scope, status, approved_by,
  approved_at, denied_at, denied_reason, revoked_at, licence_type, territory,
  exclusivity, permit_ai_training, proposed_fee, agreed_fee, platform_fee,
  download_count, last_download_at, delivery_mode, preauth_until, preauth_set_by,
  production_id, production_company_id, contract_url, contract_uploaded_at,
  contract_uploaded_by, created_at
)
SELECT
  id, talent_id, package_id, licensee_id, project_name, production_company,
  intended_use, valid_from, valid_to, file_scope, status, approved_by,
  approved_at, denied_at, denied_reason, revoked_at, licence_type, territory,
  exclusivity, permit_ai_training, proposed_fee, agreed_fee, platform_fee,
  download_count, last_download_at, delivery_mode, preauth_until, preauth_set_by,
  production_id, production_company_id, contract_url, contract_uploaded_at,
  contract_uploaded_by, created_at
FROM licences;

DROP TABLE licences;
ALTER TABLE licences_new RENAME TO licences;

CREATE INDEX IF NOT EXISTS idx_licences_talent   ON licences(talent_id);
CREATE INDEX IF NOT EXISTS idx_licences_licensee ON licences(licensee_id);
CREATE INDEX IF NOT EXISTS idx_licences_package  ON licences(package_id);
CREATE INDEX IF NOT EXISTS idx_licences_status   ON licences(status);
CREATE INDEX IF NOT EXISTS idx_licences_scrub_deadline ON licences(scrub_deadline) WHERE scrub_deadline IS NOT NULL;

CREATE TABLE scrub_attestations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  attested_by TEXT NOT NULL REFERENCES users(id),
  attested_at INTEGER NOT NULL,
  attestation_text TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  devices_scrubbed TEXT,
  bridge_cache_purged INTEGER NOT NULL DEFAULT 0,
  additional_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scrub_attestations_licence ON scrub_attestations(licence_id);

PRAGMA foreign_keys=ON;
