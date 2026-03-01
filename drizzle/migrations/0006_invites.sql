CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('talent','rep','licensee')),
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  talent_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  used_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
