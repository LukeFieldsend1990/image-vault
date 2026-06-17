-- Add true_role column to users to support industry and compliance roles.
--
-- users.role has CHECK(role IN ('talent','rep','licensee','admin')) which cannot
-- be removed without recreating the table (blocked in D1 by FK enforcement on
-- the 45+ tables that reference users). true_role stores the actual role for
-- industry and compliance users; users.role stores 'licensee' as a DB-compatible
-- fallback. At JWT-creation time (login, refresh) the effective role is
-- COALESCE(true_role, role).
ALTER TABLE users ADD COLUMN true_role TEXT;
