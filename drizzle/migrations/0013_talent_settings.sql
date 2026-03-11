-- talent_settings: per-talent pipeline toggle and fee split configuration
CREATE TABLE talent_settings (
  talent_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pipeline_enabled   INTEGER NOT NULL DEFAULT 1,
  talent_share_pct   INTEGER NOT NULL DEFAULT 65,
  agency_share_pct   INTEGER NOT NULL DEFAULT 20,
  platform_share_pct INTEGER NOT NULL DEFAULT 15,
  updated_by         TEXT REFERENCES users(id),
  updated_at         INTEGER NOT NULL,
  CHECK(talent_share_pct + agency_share_pct + platform_share_pct = 100)
);
