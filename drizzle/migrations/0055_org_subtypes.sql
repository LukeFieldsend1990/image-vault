-- Org subtypes (Step 2 of the industry migration).
--
-- Adds the environment-audit gate flag for vendor ("mover") organisations.
-- The `dubbing` org_type is a new allowed value; org_type is plain TEXT
-- (the Drizzle enum is enforced at the TS layer), so no DDL is needed for it.
ALTER TABLE organisations ADD COLUMN vendor_audit_passed INTEGER NOT NULL DEFAULT 0;
