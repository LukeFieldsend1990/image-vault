-- Path C (agent-mediated cast resolution): a reserved cast slot can be assigned
-- to a representing agent, who then resolves it by supplying their client's email.
ALTER TABLE production_cast ADD COLUMN rep_id TEXT REFERENCES users(id);
ALTER TABLE production_cast ADD COLUMN rep_invite_id TEXT;
-- Scopes a rep signup invite to a specific cast slot, so signup can link the
-- new rep to the slot they were invited to represent.
ALTER TABLE invites ADD COLUMN cast_id TEXT;
