-- Canonical use-category taxonomy (ONBOARDING-POC-GAPS-SPEC §2).
-- The vocabulary itself is code-defined (lib/consent/use-categories.ts); these
-- columns let licences and production default terms reference categories by
-- their stable ids. Stored as a JSON array of ids (e.g. '["vfx-this","dub"]').
-- The free-text `intended_use` stays as-is for notes.
ALTER TABLE licences ADD COLUMN use_categories_json TEXT;
ALTER TABLE production_default_terms ADD COLUMN use_categories_json TEXT;
