-- Roster placeholders: record cast members by name before an email/account exists.
-- Additive only. A placeholder row has status='placeholder' with talent_id/invite_id/
-- licence_id all NULL and actor_name set; it is promoted to 'invited' or 'linked' in
-- place once an email is attached. The status column has no DB-level CHECK (the enum
-- is enforced in Drizzle only), so the new value needs no schema change here.

ALTER TABLE production_cast ADD COLUMN actor_name TEXT;
ALTER TABLE production_cast ADD COLUMN tmdb_id INTEGER;
ALTER TABLE production_cast ADD COLUMN source_note TEXT;
