-- Organisation-to-organisation visibility consent (production-scoped).
--
-- Two organisations collaborating on a production can consent to see each other.
-- The connection is MUTUAL: neither side gains visibility until both accept.
-- Each side independently controls what it exposes about itself via a tier:
--   identity        → name, type, code, jurisdiction, audit posture (default)
--   contacts        → + named owner/admin contacts (who to reach)
--   shared_context  → + the production they collaborate on
--
-- This is an identity/contacts layer only. It is NEVER a path to performer
-- likeness data — that stays gated by vendor_authorisations + Bridge dual
-- custody. Every transition is mirrored into the compliance_events ledger.
-- See specs/ORG-VISIBILITY-CONSENT-SPEC.md.
CREATE TABLE IF NOT EXISTS org_connections (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  -- Canonical order: org_a_id < org_b_id (lexical) so a pair is unique per production.
  org_a_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  org_b_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  initiated_by_org_id TEXT NOT NULL REFERENCES organisations(id),
  initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'declined' | 'revoked'
  org_a_tier TEXT NOT NULL DEFAULT 'identity', -- 'identity' | 'contacts' | 'shared_context'
  org_b_tier TEXT NOT NULL DEFAULT 'identity',
  responded_by_user_id TEXT REFERENCES users(id),
  accepted_at INTEGER,
  declined_at INTEGER,
  revoked_at INTEGER,
  revoked_by_org_id TEXT REFERENCES organisations(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS org_connections_pair_idx
  ON org_connections(production_id, org_a_id, org_b_id);
CREATE INDEX IF NOT EXISTS idx_org_connections_org_a ON org_connections(org_a_id);
CREATE INDEX IF NOT EXISTS idx_org_connections_org_b ON org_connections(org_b_id);
CREATE INDEX IF NOT EXISTS idx_org_connections_production ON org_connections(production_id);
