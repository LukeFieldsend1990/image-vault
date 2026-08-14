-- Monitor cron settings — seeds only.
--
-- The cron trigger lives on ai-cron-worker (twice daily at 07:00 and 14:00
-- UTC) and calls POST /api/cron/monitor-sweeps in the main app. The main
-- app iterates monitors that are due, honouring each row's cadence.
--
-- These keys are looked up on every invocation, so they need to exist even
-- before the admin has visited the settings page. Seeded here rather than
-- inserted at first read to keep the query paths simple (never worry about
-- a missing default causing a null-pointer branch).

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_cron_enabled', 'true', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('watchlist_reharvest_hours', '168', unixepoch());
  -- 168 = weekly. Operator can raise this to weeks/months once the initial
  -- offender-account list has stabilised — hype cycles for a talent often
  -- run longer than a week (see PR discussion).

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_cron_last_run', '0', unixepoch());

-- Also seed the identity-check provider setting for PR 2's Rekognition wire-up.
-- Defaulting to llava keeps the current behaviour until the operator flips.
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('identity_check_provider', 'llava', unixepoch());
