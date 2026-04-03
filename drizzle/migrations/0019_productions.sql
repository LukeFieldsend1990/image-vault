-- Production companies (studios, VFX houses, ad agencies)
CREATE TABLE production_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_production_companies_name ON production_companies(name COLLATE NOCASE);

-- Productions (films, TV shows, games, commercials)
CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT REFERENCES production_companies(id),
  type TEXT CHECK(type IN ('film', 'tv_series', 'tv_movie', 'commercial', 'game', 'music_video', 'other')),
  year INTEGER,
  status TEXT CHECK(status IN ('development', 'pre_production', 'production', 'post_production', 'released', 'cancelled')),
  imdb_id TEXT,
  tmdb_id INTEGER,
  director TEXT,
  vfx_supervisor TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_productions_name ON productions(name COLLATE NOCASE);
CREATE INDEX idx_productions_company ON productions(company_id);

-- Link licences to production entities (nullable FKs — migration backfills these)
ALTER TABLE licences ADD COLUMN production_id TEXT REFERENCES productions(id);
ALTER TABLE licences ADD COLUMN production_company_id TEXT REFERENCES production_companies(id);
