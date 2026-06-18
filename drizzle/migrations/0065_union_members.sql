-- Union member roster (oversight): a union uploads its membership list as plain
-- comma/newline-separated names so it can see, at a glance, which members are
-- already on Image Vault and which are not. Onboarding is NOT mandated — this is
-- pure visibility. "On Image Vault" is derived at read time by matching the member
-- name against talent profiles, so nothing can drift.

CREATE TABLE union_members (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  added_by    TEXT    NOT NULL REFERENCES users(id),
  added_at    INTEGER NOT NULL,
  archived_at INTEGER                  -- soft-remove (cleared from the roster)
);

CREATE INDEX idx_union_members_active ON union_members (archived_at);
