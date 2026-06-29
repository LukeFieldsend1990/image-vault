-- Index licences by production_id. The productions list, compliance overview,
-- and cast routes all filter `WHERE production_id IN (...)`, but licences was
-- only indexed on talent_id/licensee_id/package_id/status/created_at — so those
-- production-scoped lookups fell back to full table scans.
CREATE INDEX IF NOT EXISTS idx_licences_production ON licences(production_id);
