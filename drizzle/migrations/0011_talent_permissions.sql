-- Per-talent licence type permission settings (managed by talent or rep on their behalf)
CREATE TABLE talent_licence_permissions (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  licence_type TEXT NOT NULL
    CHECK(licence_type IN ('commercial','film_double','game_character','ai_avatar','training_data','monitoring_reference')),
  permission TEXT NOT NULL DEFAULT 'approval_required'
    CHECK(permission IN ('allowed','approval_required','blocked')),
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE(talent_id, licence_type)
);
