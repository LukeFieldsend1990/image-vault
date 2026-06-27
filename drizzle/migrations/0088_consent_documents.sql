-- Performer consent documents + standing instructions.
--
-- consent_acceptances captures the document-acceptance artifact: which wording a
-- performer (or their agent) confirmed, which use categories they consented to,
-- and the evidentiary metadata. It deliberately allows null licence_id/talent_id
-- so an *unregistered* production-held performer can accept via a tokenised public
-- link before they have an account; the consent ledger (consent_records /
-- compliance_events) is populated at registration time by replaying the
-- acceptance once an identity + licence exist.
CREATE TABLE IF NOT EXISTS consent_acceptances (
  id TEXT PRIMARY KEY,
  licence_id TEXT REFERENCES licences(id) ON DELETE CASCADE,
  cast_id TEXT REFERENCES production_cast(id) ON DELETE CASCADE,
  talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_by_email TEXT,
  accepted_by_role TEXT NOT NULL DEFAULT 'talent', -- talent | rep | guest
  uses_consented_json TEXT NOT NULL DEFAULT '[]',  -- array of useCategoryId
  document_version TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  attested_at INTEGER NOT NULL,
  replayed_at INTEGER -- when the acceptance was written into the consent ledger
);

CREATE INDEX IF NOT EXISTS idx_consent_acceptances_licence ON consent_acceptances(licence_id);
CREATE INDEX IF NOT EXISTS idx_consent_acceptances_cast ON consent_acceptances(cast_id);
CREATE INDEX IF NOT EXISTS idx_consent_acceptances_talent ON consent_acceptances(talent_id);

-- standing_instructions: per-use-category disposition a registered performer (or
-- their agent on their behalf) sets once, so future requests auto-resolve. The
-- resolver only auto-acts on a unanimous all-'always' (grant) or all-'never'
-- (refuse); anything mixed or case_by_case routes to a human.
CREATE TABLE IF NOT EXISTS standing_instructions (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  use_category_id TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'case_by_case', -- always | case_by_case | never
  set_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE (talent_id, use_category_id)
);

CREATE INDEX IF NOT EXISTS idx_standing_instructions_talent ON standing_instructions(talent_id);
