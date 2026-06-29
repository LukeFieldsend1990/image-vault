-- Rep pre-negotiation on placeholders + performer custody choice.
--
-- 1) Generalise the negotiation thread so a round can hang off EITHER a licence
--    (registered performer) OR a production-held cast row (placeholder). A rep
--    reserved on a placeholder can now negotiate the §39 scope with the
--    production before the performer ever sees the document — the "current offer"
--    is the cast row's licence_terms_json scope instead of a licence's fields.
--    SQLite can't relax a NOT NULL column in place, so rebuild the table making
--    licence_id nullable and adding cast_id.
CREATE TABLE licence_negotiations_new (
  id TEXT PRIMARY KEY,
  licence_id TEXT REFERENCES licences(id) ON DELETE CASCADE,
  cast_id TEXT REFERENCES production_cast(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  party TEXT NOT NULL,                    -- producer | talent | rep
  action TEXT NOT NULL DEFAULT 'counter', -- counter | accepted | declined
  proposed_scope_json TEXT,
  proposed_fee INTEGER,
  comment TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);

INSERT INTO licence_negotiations_new
  (id, licence_id, cast_id, round, party, action, proposed_scope_json, proposed_fee, comment, created_by, created_at)
SELECT
  id, licence_id, NULL, round, party, action, proposed_scope_json, proposed_fee, comment, created_by, created_at
FROM licence_negotiations;

DROP TABLE licence_negotiations;
ALTER TABLE licence_negotiations_new RENAME TO licence_negotiations;

CREATE INDEX IF NOT EXISTS idx_licence_negotiations_licence ON licence_negotiations(licence_id);
CREATE INDEX IF NOT EXISTS idx_licence_negotiations_cast ON licence_negotiations(cast_id);

-- 2) Record the performer's custody election when they give final consent via the
--    tokenised link. 'self' = they will register and take ownership of the vault;
--    'rep_managed' = they leave the row production-held and managed by their rep
--    (the production stays the GDPR data controller and holds the scan). NULL until
--    they choose. Does not transfer ownership on its own.
ALTER TABLE production_cast ADD COLUMN custody_choice TEXT; -- self | rep_managed | null
ALTER TABLE production_cast ADD COLUMN custody_chosen_at INTEGER;
