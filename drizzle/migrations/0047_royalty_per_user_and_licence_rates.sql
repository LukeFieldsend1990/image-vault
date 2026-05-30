-- Per-user royalty meter toggle (admin governs per talent account).
-- Default 1 (enabled) so existing users aren't broken.
ALTER TABLE users ADD COLUMN royalty_meter_enabled INTEGER NOT NULL DEFAULT 1;

-- Proposed per-unit rate on AI/avatar and training-data licences.
-- Licensee proposes these when requesting; talent accepts at approval.
ALTER TABLE licences ADD COLUMN proposed_unit_type TEXT;          -- per_generation | per_1k_inferences | per_frame | per_second
ALTER TABLE licences ADD COLUMN proposed_unit_rate_pence INTEGER; -- pence per unit, proposed by licensee
ALTER TABLE licences ADD COLUMN agreed_unit_type TEXT;            -- set by talent on approval
ALTER TABLE licences ADD COLUMN agreed_unit_rate_pence INTEGER;   -- set by talent on approval
