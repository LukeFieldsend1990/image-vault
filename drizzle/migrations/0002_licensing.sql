-- Migration: 0002_licensing
-- Licensing, dual-custody download flow, and download events

CREATE TABLE IF NOT EXISTS licences (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  licensee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_name TEXT NOT NULL,
  production_company TEXT NOT NULL,
  intended_use TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  file_scope TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','APPROVED','DENIED','REVOKED','EXPIRED')),
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  denied_at INTEGER,
  denied_reason TEXT,
  revoked_at INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_licences_talent   ON licences(talent_id);
CREATE INDEX IF NOT EXISTS idx_licences_licensee ON licences(licensee_id);
CREATE INDEX IF NOT EXISTS idx_licences_package  ON licences(package_id);
CREATE INDEX IF NOT EXISTS idx_licences_status   ON licences(status);

CREATE TABLE IF NOT EXISTS download_events (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  licensee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES scan_files(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  bytes_transferred INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dl_events_licence ON download_events(licence_id);
