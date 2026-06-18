-- Insurer policies (Phase 8 §3.2) — the policy an insurer holds against a
-- production. Unlocks the underwriting dashboard's policy panel and the
-- lapsed-policy / uninsured-use flags (usage recorded outside the policy window).
-- Read access is still gated entirely by the insurer's production-scoped
-- compliance grant; this table only records the policy metadata.

CREATE TABLE insurer_policies (
  id              TEXT    PRIMARY KEY,
  grant_id        TEXT    NOT NULL REFERENCES compliance_grants(id), -- the insurer's production-scoped grant
  production_id   TEXT    NOT NULL REFERENCES productions(id),
  policy_number   TEXT,                          -- insurer's own reference
  policy_line     TEXT    NOT NULL,              -- eo | cyber | completion_bond | other
  coverage_limit  INTEGER,                       -- whole currency units (e.g. USD), nullable
  currency        TEXT    DEFAULT 'USD',
  effective_from  INTEGER,                        -- unix seconds, nullable
  effective_to    INTEGER,                        -- unix seconds, nullable
  notes           TEXT,
  created_by      TEXT    NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  archived_at     INTEGER                         -- soft delete
);

CREATE INDEX idx_insurer_policies_production ON insurer_policies (production_id);
CREATE INDEX idx_insurer_policies_grant      ON insurer_policies (grant_id);
