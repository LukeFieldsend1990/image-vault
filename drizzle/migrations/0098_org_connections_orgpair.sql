-- Make org-to-org visibility connections span productions.
--
-- Connections were originally unique per (production, orgA, orgB). They are now
-- genuinely org-to-org: a single active connection between two orgs grants
-- visibility across every production they both work on. productionId is kept as
-- the anchor (the production the connection was first offered from). Re-key
-- uniqueness onto the org pair so there is exactly one connection per pair.
DROP INDEX IF EXISTS org_connections_pair_idx;
CREATE UNIQUE INDEX IF NOT EXISTS org_connections_orgpair_idx
  ON org_connections(org_a_id, org_b_id);
