-- Carry a union through a compliance invite so an invited union watcher is
-- attributed automatically on signup. The invite already records the compliance
-- subtype in org_subtype (union|regulator|insurer); union_id names which union a
-- union invite is for, and the signup auto-grant stamps it onto the new grant.
ALTER TABLE invites ADD COLUMN union_id TEXT;
