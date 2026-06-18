-- Production watchlist (union oversight): upcoming productions believed to be
-- heading into pre-production that are NOT yet ratified on Image Vault.
--
-- The union is not mandating onboarding — this gives them visibility so they can
-- ask a production what it is doing for digital-likeness compliance. Entries are
-- sourced from TMDB candidates (promoted by an admin/platform watcher) or added
-- manually. "Ratified" status is derived at read time by matching tmdb_id or name
-- against the productions table, so no stored flag can drift.

CREATE TABLE production_watchlist (
  id                   TEXT    PRIMARY KEY,
  name                 TEXT    NOT NULL,
  company_name         TEXT,                          -- known production company (may have no org yet)
  tmdb_id              INTEGER,                        -- set when promoted from a TMDB candidate
  type                 TEXT    CHECK(type IN ('film','tv_series','tv_movie','commercial','game','music_video','other')),
  expected_stage       TEXT    NOT NULL DEFAULT 'pre_production'
                               CHECK(expected_stage IN ('development','pre_production','production','unknown')),
  expected_start_date  INTEGER,                        -- unix seconds; expected pre-production/start
  source               TEXT    NOT NULL DEFAULT 'manual' CHECK(source IN ('tmdb','manual')),
  notes                TEXT,
  flagged_for_outreach INTEGER NOT NULL DEFAULT 0,     -- union wants to contact this production
  outreach_notes       TEXT,
  added_by             TEXT    NOT NULL REFERENCES users(id),
  added_at             INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  archived_at          INTEGER                         -- soft-remove (dismissed / no longer relevant)
);

CREATE INDEX idx_production_watchlist_active ON production_watchlist (archived_at);
CREATE INDEX idx_production_watchlist_tmdb ON production_watchlist (tmdb_id);
