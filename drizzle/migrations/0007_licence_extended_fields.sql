-- Extended licence fields for commercial licensing model
ALTER TABLE licences ADD COLUMN licence_type TEXT;
ALTER TABLE licences ADD COLUMN territory TEXT;
ALTER TABLE licences ADD COLUMN exclusivity TEXT DEFAULT 'non_exclusive';
ALTER TABLE licences ADD COLUMN permit_ai_training INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licences ADD COLUMN proposed_fee INTEGER;   -- pence (licensee's offer)
ALTER TABLE licences ADD COLUMN agreed_fee INTEGER;     -- pence (set on approval)
ALTER TABLE licences ADD COLUMN platform_fee INTEGER;   -- pence (15% of agreed_fee)
