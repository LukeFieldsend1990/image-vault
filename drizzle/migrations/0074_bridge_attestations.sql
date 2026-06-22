-- Guided Bridge setup: audit-logged human attestations.
-- "local_access" = vendor confirmed their proxy folder is secured to the rules.
-- "bridge_live"  = final go-live sign-off; flips the org to Ready and notifies
-- the productions that invited it. Latest row per (organisation_id, kind) wins;
-- history is retained for the audit trail.
CREATE TABLE bridge_attestations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  attested_by_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  statement_version TEXT NOT NULL,
  attested_at INTEGER NOT NULL
);

CREATE INDEX idx_bridge_attestations_org ON bridge_attestations (organisation_id, kind, attested_at);
