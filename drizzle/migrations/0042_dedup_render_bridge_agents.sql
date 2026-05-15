-- Revoke all-but-newest active render bridge agent per org.
-- Accumulated because prior dedup matched on display_name; this backfills the fix.
UPDATE render_bridge_agents
SET
  status         = 'revoked',
  revoked_at     = unixepoch(),
  pending_action = 'purge'
WHERE revoked_at IS NULL
  AND (organisation_id, created_at) NOT IN (
    SELECT organisation_id, MAX(created_at)
    FROM render_bridge_agents
    WHERE revoked_at IS NULL
    GROUP BY organisation_id
  );
