-- Scan transfers (Step 3 of the industry migration): capture-company upload-on-behalf.
--
-- A scan_service / vendor org uploads a package either into a talent's vault
-- (to_talent) or against a production licence's pending scan (to_licence). The
-- staged package is owned by the uploading org member until accepted, then
-- ownership reassigns to the target talent.
CREATE TABLE scan_transfers (
  id TEXT PRIMARY KEY,
  from_org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  transfer_type TEXT NOT NULL,
  to_talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_licence_id TEXT REFERENCES licences(id) ON DELETE SET NULL,
  package_id TEXT NOT NULL REFERENCES scan_packages(id) ON DELETE CASCADE,
  look_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  decided_at INTEGER,
  decided_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_scan_transfers_to_talent ON scan_transfers(to_talent_id, status);
CREATE INDEX idx_scan_transfers_from_org ON scan_transfers(from_org_id, status);
CREATE INDEX idx_scan_transfers_package ON scan_transfers(package_id);
