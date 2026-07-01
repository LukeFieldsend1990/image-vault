-- RSL OLP → Image Vault licence funnel (Phase 2.5).
-- Turns an amber OLP request into a real, negotiable, metered licence.

-- Talent AI rate card: standing per-usage price list.
CREATE TABLE IF NOT EXISTS rsl_rate_cards (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  use_category_id TEXT NOT NULL,                 -- training | replica
  unit_type TEXT NOT NULL DEFAULT 'per_generation',
  unit_rate_pence INTEGER NOT NULL,              -- cents (USD minor units)
  upfront_fee_pence INTEGER,                     -- cents; nullable
  term_days INTEGER NOT NULL DEFAULT 365,
  auto_accept INTEGER NOT NULL DEFAULT 0,        -- green + this => auto-license
  currency TEXT NOT NULL DEFAULT 'USD',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (talent_id, use_category_id)
);
CREATE INDEX IF NOT EXISTS idx_rsl_rate_cards_talent ON rsl_rate_cards(talent_id);

-- AI-client → licensee mapping (the claimable stub). Deduped by client_key.
CREATE TABLE IF NOT EXISTS rsl_clients (
  id TEXT PRIMARY KEY,
  client_key TEXT NOT NULL UNIQUE,               -- normalised client_id, else contact_email
  licensee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id TEXT REFERENCES organisations(id),
  client_name TEXT,
  contact_email TEXT,
  verified INTEGER NOT NULL DEFAULT 0,           -- email-claimed
  blocked_at INTEGER,                            -- admin hard-block
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rsl_clients_licensee ON rsl_clients(licensee_id);

-- Platform kill switches (singleton row id = 'singleton').
CREATE TABLE IF NOT EXISTS rsl_settings (
  id TEXT PRIMARY KEY,
  olp_enabled INTEGER NOT NULL DEFAULT 1,
  auto_accept_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id)
);

-- Additive columns.
ALTER TABLE licences ADD COLUMN source TEXT;                       -- 'olp' for AI-originated
ALTER TABLE users ADD COLUMN unclaimed_at INTEGER;                 -- claimable stub marker
ALTER TABLE rsl_license_requests ADD COLUMN accepted_at INTEGER;   -- machine acceptance ts
ALTER TABLE royalty_sources ADD COLUMN origin TEXT;                -- 'olp'
ALTER TABLE royalty_sources ADD COLUMN client_id TEXT;            -- rsl_clients.id (labelling)
ALTER TABLE royalty_sources ADD COLUMN usage_cap_units INTEGER;   -- credit stopgap ceiling
