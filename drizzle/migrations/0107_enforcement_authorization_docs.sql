-- Enforcement authorisation: the paperwork that lets us file platform
-- takedowns on a talent's behalf. Two documents required:
--
--   * agent_letter — a signed letter naming ImageVault as the talent's
--     designated agent for platform reports. Attached to every takedown
--     Meta sends so the reviewer can verify representation.
--   * id_document — a government ID scan of the talent themselves. Meta's
--     impersonation flow refuses reports without proof the reporter (or
--     their agent) is the impersonated person.
--
-- Both are stored in R2 under monitor-legal/<talentId>/, never exposed
-- publicly. The R2 key columns are opaque to the DB; presence of both
-- keys + a non-null uploaded_at is what "authorisation on file" means.
--
-- review_status tracks admin verification separately. For pre-launch we
-- flip enforcement_authorization_on_file automatically on upload; a
-- production rollout should require a "verified" review before filing
-- reports at scale (a rejected report costs sender reputation).

ALTER TABLE talent_profiles ADD COLUMN agent_letter_key TEXT;
ALTER TABLE talent_profiles ADD COLUMN agent_letter_uploaded_at INTEGER;
ALTER TABLE talent_profiles ADD COLUMN id_document_key TEXT;
ALTER TABLE talent_profiles ADD COLUMN id_document_uploaded_at INTEGER;
ALTER TABLE talent_profiles ADD COLUMN authorization_review_status TEXT NOT NULL DEFAULT 'self_declared';
  -- self_declared | verified | rejected — admin flips after checking docs
