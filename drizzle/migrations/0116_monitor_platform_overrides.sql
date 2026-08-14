-- Per-talent platform coverage overrides for the likeness monitor.
--
-- The global toggles (0115) decide the fleet-wide default; this column lets
-- an admin widen or narrow coverage for one actor from the talent settings
-- page — e.g. switch X on for a talent being actively targeted there while
-- the platform stays off for everyone else during testing.
--
-- JSON object keyed by platform id with boolean values; an absent key
-- inherits the global toggle. Parsed and applied in
-- lib/monitor/platform-settings.ts.

ALTER TABLE likeness_monitors ADD COLUMN platform_overrides_json TEXT NOT NULL DEFAULT '{}';
