-- Store the overall RSL posture (red/amber/green) that was in effect when the
-- talent linked their Human Consent Registry ID. If the derived posture later
-- changes and diverges from this snapshot, the platform flags the discrepancy
-- so the talent knows to update their HCR listing.
ALTER TABLE rsl_profiles ADD COLUMN hcr_posture_overall TEXT;
