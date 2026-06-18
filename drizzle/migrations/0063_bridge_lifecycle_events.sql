-- No schema change: bridge_events.package_id stays NOT NULL.
-- Lifecycle events (agent_online, agent_purge_complete, etc.) use the
-- sentinel value "_lifecycle_" as package_id.
SELECT 1;
