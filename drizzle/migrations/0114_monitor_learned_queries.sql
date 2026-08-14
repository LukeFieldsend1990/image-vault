-- Learned queries per talent, per platform.
--
-- The query vocabulary in lib/monitor/ingest/queries.ts is hardcoded: "AI",
-- "deepfake", "concept trailer" etc. But confirmed hits routinely carry
-- hashtags we didn't ask for — #tomhardyrayleigh (fake role name from the
-- Anti-Venom fake trailer), #томхарди (Russian Tom Hardy), #hardyfakes.
-- Feeding those hashtags back into next sweep's query set expands
-- coverage without operator effort.
--
-- Storage is per-talent because a hashtag that finds Tom Hardy content
-- (e.g. #symbiotic) is not necessarily useful for Scarlett Johansson.
-- Global hashtags are what ROSTER_AI_HASHTAGS is for.
--
-- The `hit_count` column tracks how many confirmed hits used a given
-- query, so we can prioritise the queries with the highest yield when
-- capping the number of learned queries added per sweep (Apify budget).

CREATE TABLE IF NOT EXISTS monitor_learned_queries (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- instagram | tiktok | youtube
  query TEXT NOT NULL,    -- the hashtag or search phrase; lowercased, no leading '#'
  hit_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, -- soft-disable if a learned query never yields
  UNIQUE (talent_id, platform, query)
);

-- Lookup path: given a talent + platform, get the top-N most productive
-- learned queries. Composite index leads with the filter columns and
-- orders by hit_count desc via SQLite's automatic ordering on secondary.
CREATE INDEX IF NOT EXISTS monitor_learned_queries_talent_platform_idx
  ON monitor_learned_queries (talent_id, platform, active);
