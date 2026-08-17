-- Harvest log for account-mode discovery. One row per (platform, handle),
-- regardless of whether the handle came from the offender watchlist or the
-- seeded account list. Grounds the re-harvest cooldown (an account harvested
-- within watchlist_reharvest_hours is skipped) and incremental harvesting
-- (onlyPostsNewerThan = last harvest, so Apify bills only new posts).
CREATE TABLE monitor_harvests (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  last_harvested_at INTEGER NOT NULL,
  last_item_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_monitor_harvests_platform_handle
  ON monitor_harvests (platform, handle);
