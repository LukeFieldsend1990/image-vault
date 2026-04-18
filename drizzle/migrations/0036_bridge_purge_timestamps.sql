-- Migration: 0036_bridge_purge_timestamps
--
-- Phase 3 wind-down (P0.6): when a licence ends, the platform signals each
-- active bridge grant to purge its locally cached files immediately. The
-- bridge picks up the signal on its next status poll and drops to a 30-second
-- tight-poll interval until the purge is confirmed.
--
--   purge_requested_at — stamped by the platform at T=0 (licence revoke/expiry)
--   purge_completed_at — stamped when the bridge reports all files deleted
--                        (POST /api/bridge/grants/:grantId/purge-complete)

ALTER TABLE bridge_grants ADD COLUMN purge_requested_at INTEGER;
ALTER TABLE bridge_grants ADD COLUMN purge_completed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_bridge_grants_purge_requested
  ON bridge_grants(purge_requested_at)
  WHERE purge_requested_at IS NOT NULL AND purge_completed_at IS NULL;
