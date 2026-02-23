-- Migration: 0001_vault
-- Vault tables: scan packages, files, and multipart upload sessions

CREATE TABLE IF NOT EXISTS scan_packages (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  capture_date INTEGER,
  studio_name TEXT,
  technician_notes TEXT,
  total_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'error')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_packages_talent ON scan_packages(talent_id);

CREATE TABLE IF NOT EXISTS scan_files (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'uploading', 'complete', 'error')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_files_package ON scan_files(package_id);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  scan_file_id TEXT NOT NULL UNIQUE REFERENCES scan_files(id) ON DELETE CASCADE,
  r2_upload_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  completed_parts TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
