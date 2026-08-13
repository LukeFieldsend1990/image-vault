-- Per-talent account whitelist.
--
-- Deliberately per-talent, not global on monitor_accounts. An account
-- Tom Hardy has personally approved to post AI content of him is still
-- an offender against every other protected talent that shows up in
-- their feed. Global "cleared" on monitor_accounts already exists for
-- the cross-talent case (admin cleared, e.g. a licensed production
-- studio); this table captures the individual talent's judgement call.
--
-- Reasons are structured so the admin panel can aggregate "how many
-- accounts did talents whitelist as fan_fluff vs talent_approved" and
-- feed that back into pre-filter tuning.

CREATE TABLE IF NOT EXISTS talent_account_whitelist (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES monitor_accounts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, -- false_positive | fan_fluff | talent_approved | other
  notes TEXT,
  added_by TEXT NOT NULL REFERENCES users(id),
  added_at INTEGER NOT NULL,
  UNIQUE (talent_id, account_id)
);

-- Filter path: on every hit-list render we check whether the account is
-- on the current talent's whitelist. Talent-scoped, so the index leads
-- with talent_id.
CREATE INDEX IF NOT EXISTS talent_account_whitelist_talent_idx
  ON talent_account_whitelist (talent_id);

-- Reason aggregation for the admin tuning panel.
CREATE INDEX IF NOT EXISTS talent_account_whitelist_reason_idx
  ON talent_account_whitelist (reason);
