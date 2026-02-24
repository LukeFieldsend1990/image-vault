-- talent_reps: junction table linking reps to talent they manage
CREATE TABLE IF NOT EXISTS talent_reps (
  id          TEXT PRIMARY KEY,
  talent_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rep_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by  TEXT NOT NULL REFERENCES users(id), -- talent or admin who granted access
  created_at  INTEGER NOT NULL,
  UNIQUE(talent_id, rep_id)
);
