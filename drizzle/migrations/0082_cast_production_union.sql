-- Consistent union affiliation across cast & productions (UI: SAG-AFTRA / Equity / Other).
--
-- Additive, nullable columns. Existing semantics are unchanged:
--   * productions.is_sag / is_equity still drive compliance/underwriting.
--   * production_cast.sag_member is still the SAG flag read by compliance; the app
--     keeps it in sync from union_affiliation (sag_member = union_affiliation = 'SAG-AFTRA').
ALTER TABLE production_cast ADD COLUMN union_affiliation TEXT;
ALTER TABLE productions ADD COLUMN other_union TEXT;
