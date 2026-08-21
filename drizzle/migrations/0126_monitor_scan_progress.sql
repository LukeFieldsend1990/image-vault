-- Live sweep progress: the running scan row carries a JSON snapshot of where
-- the sweep is (stage, per-platform status, activity log) so the monitor page
-- can narrate a 5-15 minute sweep truthfully instead of animating a guess.
ALTER TABLE monitor_scans ADD COLUMN progress_json TEXT;
