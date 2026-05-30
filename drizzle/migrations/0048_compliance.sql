-- Compliance Layer (SPEC §16): SAG-AFTRA Article 39 + multi-regime consent ledger.
-- compliance_events: append-only, hash-chained ledger. Each chain (per-licence or
--   per-talent) seals every event into the next via prev_hash -> hash, so any
--   retroactive edit breaks verification. This is the spine; the other tables are
--   projections / workflow state derived from or alongside it.
-- All timestamps unix seconds, IDs are UUIDv4, booleans are 0/1 integers.

CREATE TABLE IF NOT EXISTS compliance_events (
  id              TEXT PRIMARY KEY,
  chain_key       TEXT NOT NULL,                   -- 'licence:{id}' | 'talent:{id}'
  seq             INTEGER NOT NULL,                -- monotonic within chain_key
  event_type      TEXT NOT NULL,                   -- consent.granted | strike.declared | ...
  regime          TEXT NOT NULL DEFAULT 'sag_aftra', -- sag_aftra | equity | gdpr | bipa | platform
  clause_ref      TEXT,                            -- e.g. '39.D'
  licence_id      TEXT REFERENCES licences(id) ON DELETE CASCADE,
  talent_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT REFERENCES organisations(id),
  actor_id        TEXT REFERENCES users(id),
  scope_json      TEXT NOT NULL DEFAULT '{}',      -- { useType?, territory?, language?, validFrom?, validTo?, scriptedAlterations? }
  payload_json    TEXT NOT NULL DEFAULT '{}',      -- event-specific detail (untrusted, stored as text)
  prev_hash       TEXT NOT NULL,                   -- tip hash before this event (chain_key for genesis)
  hash            TEXT NOT NULL,                   -- SHA-256(prev_hash + canonicalJson(content))
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      INTEGER NOT NULL
);

-- Append serialisation + tamper detection: one row per (chain, seq).
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_events_chain_seq
  ON compliance_events(chain_key, seq);
CREATE INDEX IF NOT EXISTS idx_compliance_events_talent ON compliance_events(talent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compliance_events_licence ON compliance_events(licence_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compliance_events_org ON compliance_events(organisation_id, event_type);

-- Current-state projection of consents (39.B/D/J), derived from consent.* events.
CREATE TABLE IF NOT EXISTS consent_records (
  id                TEXT PRIMARY KEY,
  licence_id        TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  talent_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  use_type          TEXT NOT NULL,                 -- licenceType enum value | 'dub_language'
  territory         TEXT,                           -- ISO region | 'worldwide'
  language          TEXT,                           -- for 39.D dub consent
  valid_from        INTEGER,
  valid_to          INTEGER,
  status            TEXT NOT NULL DEFAULT 'granted', -- granted | revoked | expired
  granted_event_id  TEXT NOT NULL REFERENCES compliance_events(id),
  revoked_event_id  TEXT REFERENCES compliance_events(id),
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_records_licence ON consent_records(licence_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_talent ON consent_records(talent_id, status);

-- Strike locks (39.G): admin-declared, freeze scoped replicas.
CREATE TABLE IF NOT EXISTS strike_locks (
  id            TEXT PRIMARY KEY,
  scope         TEXT NOT NULL,                     -- global | organisation | production | licence
  scope_id      TEXT,                               -- null for global; else org/production/licence id
  reason        TEXT NOT NULL,
  declared_by   TEXT NOT NULL REFERENCES users(id),
  declared_at   INTEGER NOT NULL,
  lifted_by     TEXT REFERENCES users(id),
  lifted_at     INTEGER,
  status        TEXT NOT NULL DEFAULT 'active'      -- active | lifted
);

-- Fast enforcement lookups on the download / use hot path.
CREATE INDEX IF NOT EXISTS idx_strike_locks_active ON strike_locks(status, scope, scope_id);

-- Transfer protection / escrow (39.I).
CREATE TABLE IF NOT EXISTS replica_transfers (
  id                    TEXT PRIMARY KEY,
  licence_id            TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  from_organisation_id  TEXT REFERENCES organisations(id),
  to_party_name         TEXT NOT NULL,
  to_party_details_json TEXT NOT NULL DEFAULT '{}',
  union_approved        INTEGER NOT NULL DEFAULT 0, -- transferee is Union-approved
  status                TEXT NOT NULL DEFAULT 'requested', -- requested | approved | denied
  requested_by          TEXT NOT NULL REFERENCES users(id),
  decided_by            TEXT REFERENCES users(id),
  decided_at            INTEGER,
  decision_note         TEXT,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replica_transfers_licence ON replica_transfers(licence_id);
CREATE INDEX IF NOT EXISTS idx_replica_transfers_status ON replica_transfers(status);

-- Security / biometric attestations (39.E biometric isolation, 39.H custody).
CREATE TABLE IF NOT EXISTS compliance_attestations (
  id                TEXT PRIMARY KEY,
  licence_id        TEXT REFERENCES licences(id) ON DELETE CASCADE,
  organisation_id   TEXT REFERENCES organisations(id),
  attestation_type  TEXT NOT NULL,                 -- biometric_isolation (39.E) | security_custody (39.H)
  attested_by       TEXT NOT NULL REFERENCES users(id),
  attestation_text  TEXT NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  event_id          TEXT REFERENCES compliance_events(id),
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_attestations_licence ON compliance_attestations(licence_id);

-- Generated certificate artifacts (the hero output).
CREATE TABLE IF NOT EXISTS compliance_certificates (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL,                 -- licence | talent | production
  scope_id          TEXT NOT NULL,
  regime            TEXT NOT NULL DEFAULT 'sag_aftra',
  r2_key            TEXT NOT NULL,                 -- compliance-certs/{id}.html
  ledger_tip_hash   TEXT NOT NULL,                 -- chain tip hash(es) at generation — the tamper seal
  obligations_json  TEXT NOT NULL DEFAULT '[]',    -- snapshot of met/gap per obligation
  event_count       INTEGER NOT NULL DEFAULT 0,
  generated_by      TEXT NOT NULL REFERENCES users(id),
  generated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_certificates_scope ON compliance_certificates(scope, scope_id);
