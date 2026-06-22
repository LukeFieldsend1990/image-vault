-- Repair production_cast.invite_id foreign key.
--
-- 0061_fix_role_check_constraints rebuilt the `invites` table using the SQLite
-- rename pattern (invites -> invites_old -> new invites -> drop invites_old).
-- SQLite auto-rewrote production_cast's FK target to "invites_old" during the
-- rename, and dropping invites_old left a dangling reference. The result: ANY
-- DELETE that cascades into production_cast (e.g. deleting a production) failed
-- with `no such table: main.invites_old`.
--
-- Rebuild production_cast with the correct FK to invites(id). Data and columns
-- are preserved; defer_foreign_keys lets the rebuild run inside the migration
-- transaction (validated at commit — all rows already satisfy the constraint).
PRAGMA defer_foreign_keys=ON;

CREATE TABLE production_cast_new (
  id                 TEXT PRIMARY KEY,
  production_id      TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  talent_id          TEXT REFERENCES users(id),
  invite_id          TEXT REFERENCES invites(id),
  licence_id         TEXT REFERENCES licences(id),
  character_name     TEXT,
  department         TEXT,
  sag_member         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'invited',
  licence_terms_json TEXT,
  added_by           TEXT NOT NULL REFERENCES users(id),
  added_at           INTEGER NOT NULL,
  linked_at          INTEGER,
  actor_name         TEXT,
  tmdb_id            INTEGER,
  source_note        TEXT,
  rep_id             TEXT REFERENCES users(id),
  rep_invite_id      TEXT
);

INSERT INTO production_cast_new (
  id, production_id, talent_id, invite_id, licence_id, character_name, department,
  sag_member, status, licence_terms_json, added_by, added_at, linked_at,
  actor_name, tmdb_id, source_note, rep_id, rep_invite_id
)
SELECT
  id, production_id, talent_id, invite_id, licence_id, character_name, department,
  sag_member, status, licence_terms_json, added_by, added_at, linked_at,
  actor_name, tmdb_id, source_note, rep_id, rep_invite_id
FROM production_cast;

DROP TABLE production_cast;
ALTER TABLE production_cast_new RENAME TO production_cast;

CREATE INDEX idx_production_cast_invite_id ON production_cast(invite_id);
CREATE INDEX idx_production_cast_licence_id ON production_cast(licence_id);
CREATE INDEX idx_production_cast_production_id ON production_cast(production_id);
CREATE INDEX idx_production_cast_talent_id ON production_cast(talent_id);
