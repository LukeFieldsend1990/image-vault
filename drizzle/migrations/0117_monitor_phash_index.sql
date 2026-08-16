-- Perceptual-hash derivation index for the likeness monitor.
--
-- The fourth detection layer's missing half: `perceptualHashDistance` has
-- been contracted in the candidate-signal vocabulary since the monitor
-- shipped (0-64 Hamming distance, <=16 reads as derivation), but nothing
-- ever produced a reading. This table stores a 64-bit dHash per reference
-- still so a sweep can hash candidate thumbnails and answer the one
-- question the other layers cannot: was this image derived from vault
-- imagery — a repost, leak, screenshot, or light edit of a scan still?
--
-- Rows index R2 keys and hashes only, never bytes. `status` = 'failed'
-- records stills we could not decode (oversized, unsupported format) so
-- re-syncs skip them instead of re-fetching every sweep — same rationale
-- as monitor_reference_images.status = 'rejected'. `source` separates
-- photographic scan stills from derived turntable renders so the reading
-- can be attributed honestly.

CREATE TABLE IF NOT EXISTS monitor_phash_index (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT REFERENCES scan_packages(id) ON DELETE CASCADE,
  scan_file_id TEXT REFERENCES scan_files(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'scan_still',  -- scan_still | derived_render
  algorithm TEXT NOT NULL DEFAULT 'dhash-v1',
  hash_hex TEXT,                              -- 16 hex chars; NULL when status = 'failed'
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'hashed',      -- hashed | failed
  created_at INTEGER NOT NULL,
  UNIQUE (r2_key, algorithm)
);

-- Sweep-time lookup: all hashed rows for one talent.
CREATE INDEX IF NOT EXISTS monitor_phash_index_talent_idx
  ON monitor_phash_index (talent_id, status);
