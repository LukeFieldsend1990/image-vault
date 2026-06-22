-- Production-level vendor attachment: which vendor orgs (VFX, dubbing, scan
-- service, …) work on a production. Actual scan-data access stays per-licence
-- (vendor_authorisations) gated by organisations.vendor_audit_passed.
CREATE TABLE IF NOT EXISTS production_vendors (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  vendor_org_id TEXT REFERENCES organisations(id),
  vendor_type TEXT NOT NULL,
  invited_email TEXT,
  invited_org_name TEXT,
  invite_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_production_vendors_production ON production_vendors (production_id, status);
CREATE INDEX IF NOT EXISTS idx_production_vendors_invite ON production_vendors (invite_id);
