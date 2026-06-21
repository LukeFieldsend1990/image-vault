-- Production-level default licence terms, set during guided industry onboarding
-- (Step 4) and applied as the lowest-precedence fallback when a cast placeholder
-- is resolved into a licence/invite. One row per production.
CREATE TABLE IF NOT EXISTS production_default_terms (
  production_id TEXT PRIMARY KEY REFERENCES productions(id) ON DELETE CASCADE,
  intended_use TEXT,
  licence_type TEXT,
  territory TEXT,
  exclusivity TEXT,
  permit_ai_training INTEGER NOT NULL DEFAULT 0,
  valid_from INTEGER,
  valid_to INTEGER,
  proposed_fee INTEGER,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
