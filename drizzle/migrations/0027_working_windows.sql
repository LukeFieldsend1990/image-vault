-- Access Windows: time-boxed download access replacing silent pre-authorisation.
-- Talent opens a window (with 2FA) granting a licensee temporary download rights
-- under a specific licence, with hard limits on duration and download count.

-- The window itself is a first-class auditable entity, not a flag on the licence.

CREATE TABLE access_windows (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id),
  licensee_id TEXT NOT NULL REFERENCES users(id),
  opened_by TEXT NOT NULL REFERENCES users(id),
  opened_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_downloads INTEGER NOT NULL DEFAULT 50,
  downloads_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed', 'expired', 'exhausted')),
  closed_by TEXT REFERENCES users(id),
  closed_at INTEGER,
  close_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Fast lookup: active window for a licence (only one active per licence at a time)
CREATE INDEX idx_access_windows_licence ON access_windows(licence_id);

-- Partial index: only active windows (most queries care about active ones)
CREATE INDEX idx_access_windows_active ON access_windows(status) WHERE status = 'active';

-- Talent's active windows (for "my open windows" view)
CREATE INDEX idx_access_windows_talent ON access_windows(talent_id, status);

-- Every significant event on a window — the tamper-evident audit trail.
CREATE TABLE access_window_events (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES access_windows(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('opened', 'download', 'extended', 'closed', 'expired', 'exhausted')),
  actor_id TEXT REFERENCES users(id),
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_window_events_window ON access_window_events(window_id);
CREATE INDEX idx_window_events_type ON access_window_events(event_type);

-- Backfill: migrate any active pre-auth licences into access_windows.
-- This is a one-time migration. Run after deploying the new tables.
-- Existing preauth_until / preauth_set_by columns on licences are no longer
-- read or written by application code after this migration, but remain in
-- the table (D1 does not support DROP COLUMN).
--
-- To run the backfill manually after applying this migration:
--
--   INSERT INTO access_windows (id, licence_id, talent_id, licensee_id, opened_by, opened_at, expires_at, max_downloads, downloads_used, status, created_at)
--   SELECT
--     lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
--     l.id,
--     l.talent_id,
--     l.licensee_id,
--     COALESCE(l.preauth_set_by, l.talent_id),
--     COALESCE(l.approved_at, l.created_at),
--     l.preauth_until,
--     999,
--     0,
--     CASE WHEN l.preauth_until > unixepoch() THEN 'active' ELSE 'expired' END,
--     unixepoch()
--   FROM licences l
--   WHERE l.preauth_until IS NOT NULL;
