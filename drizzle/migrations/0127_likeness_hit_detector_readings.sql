-- Persist the detector readings behind each hit. Until now the four numeric
-- signals (face similarity, pHash distance, fingerprint correlation, synthetic
-- score) and the synthetic-media analyst's observations existed only in memory
-- during the sweep — the hit kept prose, and the evidence was unrecoverable.
ALTER TABLE likeness_hits ADD COLUMN detector_readings_json TEXT;
