-- Add signed-contract PDF storage to licences
-- Populated by POST /api/licences/:id/contract/file
-- Value is an R2 object key: contracts/{licenceId}/{filename}

ALTER TABLE licences ADD COLUMN contract_url TEXT;
ALTER TABLE licences ADD COLUMN contract_uploaded_at INTEGER;
ALTER TABLE licences ADD COLUMN contract_uploaded_by TEXT REFERENCES users(id);
