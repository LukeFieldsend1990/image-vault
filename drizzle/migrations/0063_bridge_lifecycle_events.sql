-- Lifecycle events (agent_online, agent_purge_complete, etc.) have no specific
-- package context, so make bridge_events.package_id nullable.

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

CREATE TABLE bridge_events_new (
  id TEXT PRIMARY KEY,
  grant_id TEXT REFERENCES bridge_grants(id),
  package_id TEXT,
  device_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  detail TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO bridge_events_new SELECT * FROM bridge_events;

DROP TABLE bridge_events;
ALTER TABLE bridge_events_new RENAME TO bridge_events;

COMMIT;
PRAGMA foreign_keys=on;
