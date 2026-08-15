-- Body-geometry context from full-body scan meshes.
--
-- A streaming width-profile pass over the talent's full-body OBJ yields
-- relative proportions (shoulder/hip/waist ratios). These are CONTEXT ONLY:
-- OBJ vertex clouds carry no absolute scale, width heuristics cannot tell
-- muscle from clothing, and no candidate-side measurement exists. The
-- profile feeds one guarded line of the adjudicator prompt (behind the
-- ai_settings key `body_context_enabled`, default off) and is never a
-- detection signal, never a flag reason, and never raises confidence.
-- See docs/deepfake-detection.md § "Body-geometry context".

CREATE TABLE IF NOT EXISTS talent_body_profiles (
  talent_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT REFERENCES scan_packages(id) ON DELETE SET NULL,
  algorithm TEXT NOT NULL DEFAULT 'width-profile-v1',
  metrics_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
