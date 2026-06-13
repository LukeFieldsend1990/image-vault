-- Add org_subtype to invites so the intended organisation type can be
-- carried through the invite link and pre-filled during industry onboarding.
ALTER TABLE invites ADD COLUMN org_subtype TEXT;
