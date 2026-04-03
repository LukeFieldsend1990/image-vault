-- Migration: 0019_ai_features.sql
-- AI features: settings, suggestions, package tags, cost tracking, user phone

-- Optional contact phone number for all users
ALTER TABLE users ADD COLUMN phone TEXT;

-- AI feature settings (key-value store)
CREATE TABLE ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
);

INSERT INTO ai_settings (key, value, updated_by, updated_at) VALUES
  ('enabled', 'true', NULL, unixepoch()),
  ('fee_guidance_enabled', 'false', NULL, unixepoch()),
  ('licence_summary_enabled', 'false', NULL, unixepoch()),
  ('budget_ceiling_usd', '1.00', NULL, unixepoch()),
  ('max_security_alerts_per_day', '10', NULL, unixepoch());

-- Suggestions surfaced to reps/talent
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  feature TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT,
  entity_type TEXT,
  entity_id TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  acknowledged_at INTEGER,
  clicked_at INTEGER,
  expires_at INTEGER NOT NULL,
  batch_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_suggestions_user_unack ON suggestions(user_id, acknowledged_at);
CREATE INDEX idx_suggestions_created ON suggestions(created_at);

-- Package metadata tags
CREATE TABLE package_tags (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  suggested_by TEXT NOT NULL DEFAULT 'ai',
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_package_tags_package ON package_tags(package_id);
CREATE INDEX idx_package_tags_status ON package_tags(status);

-- AI cost tracking
CREATE TABLE ai_cost_log (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  feature TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_cost_log_created ON ai_cost_log(created_at);
CREATE INDEX idx_ai_cost_log_feature ON ai_cost_log(feature);
