-- Per-platform enablement for the likeness monitor — seeds only.
--
-- One row per platform in lib/monitor/platforms.ts, toggled from
-- /admin/monitor. The original three discovery surfaces keep their existing
-- behaviour (on); the newly wired platforms are born OFF so turning each one
-- on is a deliberate operator action while the detector is in testing.
-- Code-side defaults in lib/monitor/platform-settings.ts mirror these values,
-- so a missing row never changes behaviour.

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_instagram', 'true', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_tiktok', 'true', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_youtube', 'true', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_x', 'false', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_pinterest', 'false', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_google', 'false', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_getty', 'false', unixepoch());

INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
  VALUES ('monitor_platform_midjourney', 'false', unixepoch());
