-- Likeness monitor: Phase 1 true-signal detection (Apify discovery).
--
-- Adds the monitor scope/cadence/allowlist controls, the media + provenance
-- columns the real ingest populates, and the offender account case file that
-- turns a hit feed into an enforcement target list.

-- ── Monitor controls ─────────────────────────────────────────────────────────
-- scope defaults to ai_only: talent are asking about synthetic misuse, not
-- about every fan posting a red-carpet clip.
ALTER TABLE likeness_monitors ADD COLUMN scope TEXT NOT NULL DEFAULT 'ai_only';
ALTER TABLE likeness_monitors ADD COLUMN cadence TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE likeness_monitors ADD COLUMN allowlist_json TEXT NOT NULL DEFAULT '[]';

-- ── Offender case file ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitor_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  platform_user_id TEXT,
  display_name TEXT,
  follower_count INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  cumulative_views INTEGER NOT NULL DEFAULT 0,
  talent_affected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'watchlist',
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS monitor_accounts_platform_handle_idx
  ON monitor_accounts (platform, handle);

-- Watchlist lookup drives Mode B (account re-harvest) on every sweep.
CREATE INDEX IF NOT EXISTS monitor_accounts_status_idx
  ON monitor_accounts (status, platform);

-- Reach-ranked triage queue: the account worth acting on first is the one
-- accumulating views fastest, not the one with the worst single post.
CREATE INDEX IF NOT EXISTS monitor_accounts_reach_idx
  ON monitor_accounts (cumulative_views DESC);

-- ── Hit provenance + media ───────────────────────────────────────────────────
ALTER TABLE likeness_hits ADD COLUMN thumbnail_url TEXT;
ALTER TABLE likeness_hits ADD COLUMN discovery_source TEXT;
ALTER TABLE likeness_hits ADD COLUMN account_id TEXT REFERENCES monitor_accounts(id);

CREATE INDEX IF NOT EXISTS likeness_hits_account_idx
  ON likeness_hits (account_id);
