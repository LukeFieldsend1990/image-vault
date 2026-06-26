-- Production team — explicit, per-production access for org members.
--
-- Org owners/admins already run every production their org owns. This table lets
-- them associate *individual* org members ("member"-role colleagues) with a
-- specific production and pick how much they can do:
--   viewer  → read-only access to the production
--   editor  → operational rights (add vendors, edit non-key details, manage cast,
--             countries and insurers) — but NOT manage the team or delete.
--
-- A plain org member who is not listed here has no access to the production.
CREATE TABLE IF NOT EXISTS production_members (
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer', -- 'viewer' | 'editor'
  added_by TEXT REFERENCES users(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (production_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_production_members_production ON production_members(production_id);
CREATE INDEX IF NOT EXISTS idx_production_members_user ON production_members(user_id);
