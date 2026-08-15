-- Derived reference stills: turntable renders (and 360°-video frame grabs)
-- produced from mesh-only scan packages so they stop scoring "unanchored".
--
-- `source` on monitor_reference_images separates photographic vault stills
-- from platform-derived renders: derived stills count at half weight in the
-- coverage score (geometry-true, but texture/lighting-untrue) and the card
-- can say honestly where a talent's anchoring comes from.
--
-- derived_render_jobs tracks one render job per package, including the
-- 'skipped' outcome when the Browser Rendering binding is absent — the job
-- degrades gracefully, it never fails the pipeline.

ALTER TABLE monitor_reference_images ADD COLUMN source TEXT NOT NULL DEFAULT 'vault_still';
-- vault_still | derived_render

CREATE TABLE IF NOT EXISTS derived_render_jobs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | complete | failed | skipped
  strategy TEXT,                          -- video_frames | mesh_turntable
  stills_created INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS derived_render_jobs_package_idx
  ON derived_render_jobs (package_id, status);
