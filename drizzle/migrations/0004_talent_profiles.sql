-- Migration: 0004_talent_profiles
-- Stores verified talent identity linked to TMDB

CREATE TABLE IF NOT EXISTS talent_profiles (
  user_id          TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name        TEXT    NOT NULL,
  tmdb_id          INTEGER,
  profile_image_url TEXT,
  known_for        TEXT    NOT NULL DEFAULT '[]', -- JSON: [{title, year, type}]
  popularity       REAL,
  onboarded_at     INTEGER NOT NULL
);
