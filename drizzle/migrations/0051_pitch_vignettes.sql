-- Pitch Vignettes — AI-generated casting pitch videos via Higgsfield
CREATE TABLE IF NOT EXISTS pitch_vignettes (
  id                    TEXT PRIMARY KEY,
  talent_id             TEXT NOT NULL,
  package_id            TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  created_by            TEXT NOT NULL,
  production_name       TEXT NOT NULL,
  character_description TEXT NOT NULL,
  tone                  TEXT NOT NULL DEFAULT 'dramatic',
  include_audio         INTEGER NOT NULL DEFAULT 0,
  source_image_keys     TEXT NOT NULL DEFAULT '[]',
  generated_prompt      TEXT,
  higgsfield_job_id     TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  output_r2_key         TEXT,
  output_duration_s     INTEGER,
  error_text            TEXT,
  created_at            INTEGER NOT NULL,
  completed_at          INTEGER,
  deleted_at            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pitch_vignettes_package ON pitch_vignettes(package_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_pitch_vignettes_talent  ON pitch_vignettes(talent_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_pitch_vignettes_status  ON pitch_vignettes(status);

-- Opt-out flag on talent_profiles (default 1 = enabled)
ALTER TABLE talent_profiles ADD COLUMN pitch_vignettes_enabled INTEGER NOT NULL DEFAULT 1;
