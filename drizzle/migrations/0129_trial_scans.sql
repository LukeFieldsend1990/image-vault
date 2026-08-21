-- Likeness Scout trials: rep/production accounts run a limited number of
-- trial likeness sweeps on any TMDB actor — no vault, no talent account.
-- Subjects are keyed by TMDB person id, which is why these rows cannot live
-- in monitor_scans / likeness_hits (both FK a talent user). When the actor
-- later onboards, lib/monitor/trial.ts migrates the hits into their monitor.

CREATE TABLE IF NOT EXISTS trial_scans (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  tmdb_name TEXT NOT NULL,
  tmdb_profile_url TEXT,
  known_for_json TEXT NOT NULL DEFAULT '[]',
  popularity REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  platforms_checked INTEGER NOT NULL DEFAULT 0,
  candidates_analysed INTEGER NOT NULL DEFAULT 0,
  hits_found INTEGER NOT NULL DEFAULT 0,
  ai_provider TEXT,
  error TEXT,
  progress_json TEXT,
  coverage_tier TEXT,
  coverage_score INTEGER,
  converted_talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  converted_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_trial_scans_requested_by
  ON trial_scans (requested_by, created_at);
CREATE INDEX IF NOT EXISTS idx_trial_scans_tmdb
  ON trial_scans (tmdb_id, status);

CREATE TABLE IF NOT EXISTS trial_reference_photos (
  id TEXT PRIMARY KEY,
  trial_id TEXT NOT NULL REFERENCES trial_scans(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'face',
  original_name TEXT,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_reference_photos_trial
  ON trial_reference_photos (trial_id);

CREATE TABLE IF NOT EXISTS trial_hits (
  id TEXT PRIMARY KEY,
  trial_id TEXT NOT NULL REFERENCES trial_scans(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'reel',
  content_url TEXT NOT NULL,
  author_handle TEXT,
  caption TEXT,
  nsfw INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL,
  ai_generated_likelihood INTEGER NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  match_signals_json TEXT NOT NULL DEFAULT '[]',
  ai_rationale TEXT,
  detector_readings_json TEXT,
  thumbnail_url TEXT,
  thumbnail_key TEXT,
  discovery_source TEXT,
  migrated_hit_id TEXT,
  detected_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_hits_trial
  ON trial_hits (trial_id);
CREATE INDEX IF NOT EXISTS idx_trial_hits_tmdb
  ON trial_hits (tmdb_id);

CREATE TABLE IF NOT EXISTS trial_allowances (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  extra_runs INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
