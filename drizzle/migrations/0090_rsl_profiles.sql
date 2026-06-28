-- RSL (Really Simple Licensing) public consent profile — Phase 1.
--
-- Exposure controls + minimal public-card fields only. The consent posture
-- itself is NOT stored here: it is derived at read time from
-- standing_instructions on the AI use-categories (training §39G, replica §39E),
-- so the public posture can never drift from what the talent actually set.
--
-- A public surface is served only when BOTH publish_opt_in (talent's key) AND
-- admin_approved (admin master switch) are true AND a public_slug exists.
-- Both keys default off; nothing is exposed to the public internet by default.
CREATE TABLE IF NOT EXISTS rsl_profiles (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  publish_opt_in INTEGER NOT NULL DEFAULT 0,
  admin_approved INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT REFERENCES users(id),
  approved_at INTEGER,
  public_slug TEXT UNIQUE,
  display_name TEXT,
  profession TEXT,
  links_json TEXT,
  license_server_enabled INTEGER NOT NULL DEFAULT 0,
  human_consent_id TEXT,
  registry_status TEXT NOT NULL DEFAULT 'not_linked',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rsl_profiles_talent ON rsl_profiles(talent_id);
CREATE INDEX IF NOT EXISTS idx_rsl_profiles_slug ON rsl_profiles(public_slug);
