-- Agency-as-organisation + agent identity (Onboarding POC gap #4).
--
-- Agencies are modelled as an `organisations` row with org_type = 'agency'
-- (AGY code). Their members are existing `rep`-role users acting as agents.
-- `talent_reps.agency_org_id` is the explicit routing key the agent inbox (#1)
-- will read to send a represented performer's requests to the right agency.
--
-- The 'agency' org_type value itself needs no DDL — org_type is a plain text
-- column with no DB-level CHECK; the allowed set is enforced in TypeScript via
-- lib/organisations/orgTypes.ts.

ALTER TABLE talent_reps ADD COLUMN agency_org_id TEXT REFERENCES organisations(id) ON DELETE SET NULL;
