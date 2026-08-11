-- Apify spend ledger + enforced ceiling for likeness-monitor discovery.
--
-- cost_usd is Apify's own usageTotalUsd for the run, not an estimate from item
-- counts, so the ceiling in lib/monitor/ingest/budget.ts sums the same figure
-- Apify bills. cost_estimated flags the rows where the run reported no usage
-- and we fell back to a per-item rate.

CREATE TABLE IF NOT EXISTS apify_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  actor_id TEXT NOT NULL,
  mode TEXT,
  query TEXT,
  talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  scan_id TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_estimated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'succeeded',
  error TEXT,
  created_at INTEGER NOT NULL
);

-- The budget gate runs before every actor invocation, so the sum over the
-- current period has to be cheap.
CREATE INDEX IF NOT EXISTS apify_usage_created_idx ON apify_usage (created_at);
CREATE INDEX IF NOT EXISTS apify_usage_talent_idx ON apify_usage (talent_id, created_at);

-- Seed the ceiling low while testing. Managed from /admin/monitor thereafter.
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('apify_budget_ceiling_usd', '5.00', unixepoch());
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('apify_enabled', 'true', unixepoch());
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('apify_budget_since', '0', unixepoch());
