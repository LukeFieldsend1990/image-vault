-- Admin concierge production invite: the org the invited industry user should be
-- made owner of on signup (the production was pre-built by an admin under it).
ALTER TABLE invites ADD COLUMN organisation_id TEXT;
