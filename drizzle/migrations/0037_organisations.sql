-- organisations: auth-connected production company entities
CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  billing_email TEXT,
  production_company_id TEXT REFERENCES production_companies(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- organisation_members: many-to-many licensee users ↔ orgs
CREATE TABLE IF NOT EXISTS organisation_members (
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (organisation_id, user_id)
);

-- organisation_invites: time-limited invite tokens
CREATE TABLE IF NOT EXISTS organisation_invites (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL
);
