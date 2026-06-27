-- Org-level toggle (owner-only) to restore implicit production access for org
-- owners. Off by default: only a production's owner (coordinator / org founder)
-- reaches it unless colleagues are explicitly added to its team. When on, every
-- organisation owner can access every production the org owns, as before.
ALTER TABLE organisations ADD COLUMN owner_implicit_access INTEGER NOT NULL DEFAULT 0;
