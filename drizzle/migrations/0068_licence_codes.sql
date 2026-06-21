-- Public licence reference codes (LC-####).
--
-- Licences were only addressable by their internal UUID, which is never shown to
-- users. The Scan Transfers flow ("deliver against a production licence") asks the
-- sending organisation for a "Licence ID" — but there was no user-facing identifier
-- to give them. LC-#### is that public reference: minted at creation, displayed on
-- the licence, and accepted by the transfer form. It is an identifier/decorator
-- only — never a download key or auth secret.
ALTER TABLE licences ADD COLUMN short_code TEXT;

-- Backfill existing rows in creation order (rowid). printf('%04d') gives a minimum
-- of 4 digits and expands naturally (247 -> 0247, 12476 -> 12476).
UPDATE licences SET short_code = 'LC-' || printf('%04d',
  (SELECT COUNT(*) FROM licences l2 WHERE l2.rowid <= licences.rowid));
