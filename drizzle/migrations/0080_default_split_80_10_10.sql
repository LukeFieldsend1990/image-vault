-- Change the default revenue split for new talent_settings rows from 65/20/15 to 80/10/10.
-- Existing rows are unaffected; only rows inserted without explicit values will use the new defaults.
-- SQLite does not support ALTER COLUMN DEFAULT, so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE talent_settings_new (
  talent_id          TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pipeline_enabled   INTEGER NOT NULL DEFAULT 1,
  talent_share_pct   INTEGER NOT NULL DEFAULT 80,
  agency_share_pct   INTEGER NOT NULL DEFAULT 10,
  platform_share_pct INTEGER NOT NULL DEFAULT 10,
  tier               TEXT,
  updated_by         TEXT REFERENCES users(id),
  updated_at         INTEGER NOT NULL,
  CHECK(talent_share_pct + agency_share_pct + platform_share_pct = 100)
);

INSERT INTO talent_settings_new SELECT * FROM talent_settings;

DROP TABLE talent_settings;
ALTER TABLE talent_settings_new RENAME TO talent_settings;

PRAGMA foreign_keys = ON;
