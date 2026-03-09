-- Pipeline jobs: one row per pipeline run for a scan package
CREATE TABLE pipeline_jobs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id),
  initiated_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','processing','complete','failed','cancelled')),
  skus TEXT NOT NULL DEFAULT '["preview","realtime","vfx"]',
  output_r2_prefix TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

-- Stage-level progress tracking
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','running','complete','failed','skipped')),
  log TEXT,
  metadata TEXT,
  started_at INTEGER,
  completed_at INTEGER
);

-- Output artifacts per SKU (presignable R2 keys)
CREATE TABLE pipeline_outputs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  sku TEXT NOT NULL CHECK(sku IN ('preview','realtime','vfx','training')),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
