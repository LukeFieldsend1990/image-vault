-- Production onboarding feedback (items 7, 9, 11).
--
-- All additive, nullable columns — existing rows and readers are unaffected.
--
-- 1. Multi-select licence "use type" (item 7). A single licence/term set can now
--    carry several use types instead of one. The legacy single `licence_type`
--    enum column is kept populated with the primary (first) selection for
--    back-compat; `licence_types_json` is the canonical JSON array of the same
--    enum values (film_double | game_character | commercial | ai_avatar |
--    training_data | monitoring_reference). One licence row carries the array —
--    there is NO per-type fan-out into separate licences/contracts.
--
-- 2. Relicensing (item 9). `is_relicense` flags a licence (or default-terms /
--    cast row) as a re-licence rather than a fresh production scan. Fees can be
--    explicitly N/A (NULL proposed_fee) for standard production scans, distinct
--    from a £0 fee; the relicense flag marks the case where a fee is expected.
--
-- 3. Data-controller attribution for unclaimed talent (item 11). While a cast
--    placeholder has no talentId, the production is the GDPR data controller for
--    that likeness (side-agreement 39J). On claim the attribution is cleared and
--    the handover recorded in the chain of custody.

ALTER TABLE licences ADD COLUMN licence_types_json TEXT;
ALTER TABLE licences ADD COLUMN is_relicense INTEGER;

ALTER TABLE production_default_terms ADD COLUMN licence_types_json TEXT;
ALTER TABLE production_default_terms ADD COLUMN is_relicense INTEGER;

ALTER TABLE production_cast ADD COLUMN data_controller_org_id TEXT;
ALTER TABLE production_cast ADD COLUMN data_controller_since INTEGER;
