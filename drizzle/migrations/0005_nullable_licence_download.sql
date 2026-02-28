-- Make licence_id nullable on download_events so talent's own direct
-- downloads can be recorded without a licence reference.
-- SQLite requires recreating the table to change a column constraint.

PRAGMA foreign_keys=OFF;

CREATE TABLE download_events_new (
  id TEXT PRIMARY KEY,
  licence_id TEXT REFERENCES licences(id) ON DELETE CASCADE,
  licensee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES scan_files(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  bytes_transferred INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

INSERT INTO download_events_new SELECT * FROM download_events;
DROP TABLE download_events;
ALTER TABLE download_events_new RENAME TO download_events;

PRAGMA foreign_keys=ON;
