-- Per-sweep record of the discovery queries actually issued.
--
-- The Apify usage ledger already books the paid runs, but it exists to police
-- spend: it never sees the free surfaces (YouTube, Civitai) or the simulated
-- crawler. This table is the sweep's own account of what it searched for, so
-- the admin sweep view can show the hashtags and search terms behind every run
-- rather than inferring them from whichever hits happened to land.

CREATE TABLE IF NOT EXISTS monitor_scan_queries (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES monitor_scans(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  query TEXT NOT NULL,
  result_count INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'succeeded',
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitor_scan_queries_scan
  ON monitor_scan_queries(scan_id);

-- Cross-run question: "how often have we swept #tomhardyai, and what did it
-- ever return?" — asked per term, so the term leads the index.
CREATE INDEX IF NOT EXISTS idx_monitor_scan_queries_query
  ON monitor_scan_queries(query, created_at);
