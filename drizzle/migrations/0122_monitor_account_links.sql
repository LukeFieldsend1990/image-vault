-- Cross-platform sibling leads for offender accounts.
--
-- Crossposters reuse their handle: the account flagged on Instagram is usually
-- the same account on TikTok, publishing the same post. Sweeps probe the
-- highest-reach accounts for siblings on the other platforms and record every
-- answer here — including the negatives, which is what stops the next sweep
-- paying to ask the same question again.
CREATE TABLE IF NOT EXISTS monitor_account_links (
  id TEXT PRIMARY KEY,
  source_account_id TEXT NOT NULL REFERENCES monitor_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'name_only',
  matched_posts INTEGER NOT NULL DEFAULT 0,
  best_similarity INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT,
  promoted_account_id TEXT REFERENCES monitor_accounts(id),
  discovered_by_talent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  checked_at INTEGER,
  UNIQUE (source_account_id, platform, handle)
);

CREATE INDEX IF NOT EXISTS idx_monitor_account_links_status
  ON monitor_account_links (status, created_at);
