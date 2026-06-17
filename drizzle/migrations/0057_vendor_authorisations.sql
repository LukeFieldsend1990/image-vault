-- Vendor authorisations (Step 4): producer → vendor access within a licence.
--
-- A production (the licence holder) authorises specific vendor orgs to pull the
-- licensed scan via the Bridge, bounded by the licence's type/time. An
-- authorised vendor can nominate a sub-vendor under its own authorisation
-- (parent_authorisation_id set; nominated_by_org_id = the parent vendor org).
CREATE TABLE vendor_authorisations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  vendor_org_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  parent_authorisation_id TEXT,
  nominated_by_org_id TEXT REFERENCES organisations(id),
  authorised_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_vendor_auth_licence ON vendor_authorisations(licence_id, status);
CREATE INDEX idx_vendor_auth_org ON vendor_authorisations(vendor_org_id, status);
CREATE INDEX idx_vendor_auth_parent ON vendor_authorisations(parent_authorisation_id);
