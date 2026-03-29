-- Add pre-authorisation fields to licences
ALTER TABLE licences ADD COLUMN preauth_until INTEGER;
ALTER TABLE licences ADD COLUMN preauth_set_by TEXT REFERENCES users(id);
