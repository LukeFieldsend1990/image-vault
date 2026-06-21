-- Production-included licences: the scan was commissioned and paid for as part
-- of the production, so the licence fee is £0 and it does not count as a re-licence.
ALTER TABLE licences ADD COLUMN production_included INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licences ADD COLUMN inclusion_reason TEXT;
ALTER TABLE licences ADD COLUMN inclusion_marked_by TEXT REFERENCES users(id);
ALTER TABLE licences ADD COLUMN inclusion_marked_at INTEGER;

-- High-detail audit trail for inclusion markings. `flagged` rows had prior usage
-- through the platform when inclusion was claimed — surfaced for admin review.
CREATE TABLE IF NOT EXISTS production_inclusion_records (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  production_id TEXT REFERENCES productions(id),
  package_id TEXT,
  talent_id TEXT NOT NULL REFERENCES users(id),
  marked_by TEXT NOT NULL REFERENCES users(id),
  marked_at INTEGER NOT NULL,
  reason TEXT,
  prior_licence_count INTEGER NOT NULL DEFAULT 0,
  prior_download_count INTEGER NOT NULL DEFAULT 0,
  prior_usage_json TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_inclusion_records_flagged ON production_inclusion_records (flagged, marked_at);
