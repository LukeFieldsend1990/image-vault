-- Reddit joins the likeness monitor's platform registry — seed only.
--
-- Born OFF, same as every surface added after the original three: enabling it
-- is a deliberate operator action from /admin/monitor while the detector is in
-- testing. The code-side default in lib/monitor/platforms.ts mirrors this, so
-- a missing row never changes behaviour.

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_reddit', 'false', unixepoch());
