-- Per-talent metering for the likeness monitor (lib/monitor/metering.ts).
-- `plan` picks a monthly discovery allowance; `monthly_budget_usd` is an
-- explicit per-talent override of the plan default. Spend is summed from the
-- existing apify_usage ledger (talent_id has been on it from the start), so
-- no balance table is needed. Default 'internal' = unmetered, which preserves
-- the pre-plan behaviour for every existing monitor row.
ALTER TABLE likeness_monitors ADD COLUMN plan TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE likeness_monitors ADD COLUMN monthly_budget_usd REAL;
