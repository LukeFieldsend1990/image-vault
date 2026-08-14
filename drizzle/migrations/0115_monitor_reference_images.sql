-- Vault-anchored reference set for the likeness monitor.
--
-- Until now identity matching anchored on a single public photo (the
-- talent's TMDB headshot). The vault already holds far better ground
-- truth: studio-grade scan packages with multi-angle face and full-body
-- captures. This table indexes which scan files serve as match
-- references, so a sweep compares candidate content against the talent's
-- actual biometric captures — a reference gallery no outside detector
-- has access to.
--
-- Rows reference R2 keys, they never copy bytes: the scan stays in the
-- vault and is presigned for the few seconds a sweep needs it. Deleting
-- a package or file cascades its references away.
--
-- `kind` distinguishes face captures from full-body captures because the
-- detection-coverage score rewards having both; `status` = 'rejected'
-- marks files the face-presence check ruled out (mesh renders, texture
-- sheets), so re-syncs skip them instead of re-testing every sweep.

CREATE TABLE IF NOT EXISTS monitor_reference_images (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  scan_file_id TEXT NOT NULL REFERENCES scan_files(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'unknown',     -- face | full_body | unknown
  status TEXT NOT NULL DEFAULT 'active',    -- active | rejected
  created_at INTEGER NOT NULL,
  UNIQUE (scan_file_id)
);

-- Sweep-time lookup: all active references for one talent.
CREATE INDEX IF NOT EXISTS monitor_reference_images_talent_idx
  ON monitor_reference_images (talent_id, status);
