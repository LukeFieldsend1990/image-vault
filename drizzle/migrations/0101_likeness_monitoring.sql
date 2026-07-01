-- Likeness monitoring: AI-adjudicated detection of unauthorised likeness usage
-- on public short-form platforms. One monitor per talent; each scan sweeps the
-- platform list, adjudicates candidate content with callAi(), and persists
-- confirmed hits for triage (alert → review → takedown / dismiss).

CREATE TABLE IF NOT EXISTS likeness_monitors (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused
  sensitivity TEXT NOT NULL DEFAULT 'balanced', -- strict | balanced | relaxed
  last_scan_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_scans (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES likeness_monitors(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',       -- manual | scheduled
  status TEXT NOT NULL DEFAULT 'running',       -- running | complete | error
  platforms_checked INTEGER NOT NULL DEFAULT 0,
  candidates_analysed INTEGER NOT NULL DEFAULT 0,
  hits_found INTEGER NOT NULL DEFAULT 0,
  ai_provider TEXT,                             -- ai | heuristic
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_monitor_scans_talent ON monitor_scans(talent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS likeness_hits (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES monitor_scans(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                       -- instagram | tiktok | youtube | x
  content_type TEXT NOT NULL DEFAULT 'reel',    -- reel | short | video | post
  content_url TEXT NOT NULL,
  author_handle TEXT,
  caption TEXT,
  confidence INTEGER NOT NULL,                  -- 0-100 likeness match confidence
  ai_generated_likelihood INTEGER NOT NULL,     -- 0-100 synthetic-media likelihood
  risk_level TEXT NOT NULL DEFAULT 'medium',    -- low | medium | high | critical
  match_signals_json TEXT NOT NULL DEFAULT '[]',-- JSON string[] of evidence signals
  ai_rationale TEXT,                            -- adjudicator's explanation
  status TEXT NOT NULL DEFAULT 'new',           -- new | confirmed | dismissed | takedown_requested | resolved
  status_updated_by TEXT REFERENCES users(id),
  status_updated_at INTEGER,
  detected_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_likeness_hits_talent ON likeness_hits(talent_id, detected_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_likeness_hits_url ON likeness_hits(talent_id, content_url);
