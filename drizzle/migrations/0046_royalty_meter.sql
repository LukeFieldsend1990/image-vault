-- Live Royalty Meter (SPEC §15): pay-as-you-go likeness usage feed.
-- royalty_sources: a studio / AI company integration, scoped to a licence, that
--   POSTs usage events with a royalty source API key (rsk_).
-- usage_events: one row per reported generation; the meter that the talent's
--   Royalty Hub reads. Money in integer pence, timestamps in unix seconds.

CREATE TABLE IF NOT EXISTS royalty_sources (
  id              TEXT PRIMARY KEY,
  licence_id      TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  organisation_id TEXT REFERENCES organisations(id),
  display_name    TEXT NOT NULL,
  api_key_hash    TEXT NOT NULL UNIQUE,            -- SHA-256 of raw rsk_ key
  unit_type       TEXT NOT NULL DEFAULT 'per_generation', -- per_generation | per_1k_inferences | per_frame | per_second
  unit_rate_pence INTEGER NOT NULL,               -- server-trusted price per unit
  status          TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  created_by      TEXT REFERENCES users(id),
  revoked_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_royalty_sources_licence ON royalty_sources(licence_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES royalty_sources(id) ON DELETE CASCADE,
  licence_id      TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  talent_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  units           INTEGER NOT NULL,
  unit_rate_pence INTEGER NOT NULL,
  gross_pence     INTEGER NOT NULL,
  talent_pence    INTEGER NOT NULL,
  agency_pence    INTEGER NOT NULL,
  platform_pence  INTEGER NOT NULL,
  external_ref    TEXT,
  detail_json     TEXT,
  occurred_at     INTEGER NOT NULL,
  recorded_at     INTEGER NOT NULL
);

-- Idempotency: a replay of the same generation id from the same source dedupes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_source_extref
  ON usage_events(source_id, external_ref);

-- Powers the live feed and time-windowed aggregates on the Royalty Hub.
CREATE INDEX IF NOT EXISTS idx_usage_events_talent_recorded
  ON usage_events(talent_id, recorded_at);
