-- Industry organisations carry a country / jurisdiction (the country the org
-- is registered in). Same two-part shape as production_countries: a free-form
-- country/region name plus a top-level jurisdiction id (UK | EU | US | CH | ...).
-- The country is collected during org onboarding; existing rows are backfilled
-- to the United Kingdom so the column is always populated going forward.
--
-- Vendor attachments propagate the vendor org's country onto the production's
-- in-scope country list (productions inherit the data-protection regimes of
-- every place data activity touches). added_via_vendor_id records that a
-- production_countries row was inserted because a vendor needs it — when the
-- vendor detaches and no other active vendor needs that country, the row is
-- soft-removed. Manually-added countries (added_via_vendor_id IS NULL) are
-- never auto-removed.

ALTER TABLE organisations ADD COLUMN country TEXT;
ALTER TABLE organisations ADD COLUMN country_top_level_id TEXT;
UPDATE organisations SET country = 'United Kingdom', country_top_level_id = 'UK' WHERE country IS NULL;

ALTER TABLE production_countries ADD COLUMN added_via_vendor_id TEXT REFERENCES production_vendors(id) ON DELETE SET NULL;
