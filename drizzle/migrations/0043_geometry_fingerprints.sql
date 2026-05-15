-- Tracks async watermarking jobs triggered on licence approval
CREATE TABLE IF NOT EXISTS geometry_fingerprint_jobs (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  files_total INTEGER,
  files_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Records issued geometric fingerprints (one per licence+OBJ file)
CREATE TABLE IF NOT EXISTS geometry_fingerprints (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  licence_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  licensee_id TEXT NOT NULL,
  watermarked_r2_key TEXT NOT NULL,
  fingerprint_payload_hash TEXT NOT NULL,
  fingerprint_bits TEXT NOT NULL,
  fingerprint_bits_length INTEGER NOT NULL DEFAULT 128,
  repeat_factor INTEGER NOT NULL DEFAULT 5,
  watermark_strength REAL NOT NULL DEFAULT 0.00001,
  watermark_region_count INTEGER,
  fingerprint_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geo_fingerprints_licence_file
  ON geometry_fingerprints(licence_id, file_id);
CREATE INDEX IF NOT EXISTS idx_geo_fingerprints_package_file
  ON geometry_fingerprints(package_id, file_id);
CREATE INDEX IF NOT EXISTS idx_geo_fingerprint_jobs_licence
  ON geometry_fingerprint_jobs(licence_id);
