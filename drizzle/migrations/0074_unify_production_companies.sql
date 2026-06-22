-- Unify production companies onto organisations.
--
-- Organisations are now the single source of truth for "production companies".
-- The production_companies table is kept as a 1:1 catalogue shim, linked via
-- organisations.production_company_id, so legacy productions.company_id /
-- licences.production_company_id attribution keeps working. This backfill:
--   1. links existing production-company / studio orgs to a same-named shim
--   2. creates a member-less organisation for every catalogue-only company
--   3. re-attributes productions to the resulting organisation
--   4. re-attributes licences to the resulting organisation
-- After this runs, every production company is represented by an organisation,
-- so /admin/organisations and the Productions screen list the same entities.

-- 1. Link existing production-company / studio orgs to a name-matching shim.
UPDATE organisations
SET production_company_id = (
  SELECT pc.id FROM production_companies pc
  WHERE lower(pc.name) = lower(organisations.name)
  LIMIT 1
)
WHERE production_company_id IS NULL
  AND org_type IN ('production_company', 'studio')
  AND EXISTS (
    SELECT 1 FROM production_companies pc WHERE lower(pc.name) = lower(organisations.name)
  );

-- 2. Create a member-less organisation for each catalogue company that has no
--    linked org and no name-matching production-company org. created_by falls
--    back to a linked production's coordinator, else the earliest user.
INSERT INTO organisations (id, name, production_company_id, created_by, created_at, updated_at, org_type, vendor_audit_passed)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  pc.name,
  pc.id,
  COALESCE(
    (SELECT p.coordinator_id FROM productions p WHERE p.company_id = pc.id AND p.coordinator_id IS NOT NULL LIMIT 1),
    (SELECT u.id FROM users u ORDER BY u.created_at LIMIT 1)
  ),
  unixepoch(),
  unixepoch(),
  'production_company',
  0
FROM production_companies pc
WHERE NOT EXISTS (SELECT 1 FROM organisations o WHERE o.production_company_id = pc.id)
  AND NOT EXISTS (
    SELECT 1 FROM organisations o
    WHERE lower(o.name) = lower(pc.name) AND o.org_type IN ('production_company', 'studio')
  )
  AND EXISTS (SELECT 1 FROM users);

-- 3. Attribute productions to the organisation linked to their company.
UPDATE productions
SET organisation_id = (
  SELECT o.id FROM organisations o WHERE o.production_company_id = productions.company_id LIMIT 1
)
WHERE organisation_id IS NULL
  AND company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM organisations o WHERE o.production_company_id = productions.company_id
  );

-- 4. Attribute licences to the organisation linked to their company.
UPDATE licences
SET organisation_id = (
  SELECT o.id FROM organisations o WHERE o.production_company_id = licences.production_company_id LIMIT 1
)
WHERE organisation_id IS NULL
  AND production_company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM organisations o WHERE o.production_company_id = licences.production_company_id
  );
