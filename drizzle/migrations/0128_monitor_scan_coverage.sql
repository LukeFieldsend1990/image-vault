-- Record detection coverage at scan time. The tier/score were computed every
-- sweep and thrown away, so "your monitoring got stronger since you added a
-- scan" was unprovable after the fact.
ALTER TABLE monitor_scans ADD COLUMN coverage_tier TEXT;
ALTER TABLE monitor_scans ADD COLUMN coverage_score INTEGER;
