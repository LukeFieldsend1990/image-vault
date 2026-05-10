-- Attach licences and productions to auth-connected organisations
ALTER TABLE licences ADD COLUMN organisation_id TEXT REFERENCES organisations(id);
ALTER TABLE productions ADD COLUMN organisation_id TEXT REFERENCES organisations(id);
