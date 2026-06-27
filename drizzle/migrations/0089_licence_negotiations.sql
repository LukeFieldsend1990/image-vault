-- Licence negotiation thread — the back-and-forth between a production and a
-- performer (or their agent) over consent terms before consent is finalised.
--
-- One row per round (a message in the thread). The producer's initial offer is
-- the licence's own fields (useCategoriesJson + proposedFee); rounds capture each
-- subsequent counter. A talent/rep counter is a *conditional consent* — "I'll
-- consent to THIS instead". When the other side accepts, terms are applied to the
-- licence and consent is recorded.
CREATE TABLE IF NOT EXISTS licence_negotiations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,                 -- 1, 2, 3 …
  party TEXT NOT NULL,                    -- producer | talent | rep
  action TEXT NOT NULL DEFAULT 'counter', -- counter | accepted | declined
  proposed_scope_json TEXT,               -- array of useCategoryId
  proposed_fee INTEGER,                   -- pence; null = N/A
  comment TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licence_negotiations_licence ON licence_negotiations(licence_id);
