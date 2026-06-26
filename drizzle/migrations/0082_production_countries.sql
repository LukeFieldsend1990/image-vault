-- Productions track their home jurisdiction (the country the production company
-- is registered in / where the show "lives" for compliance purposes) and any
-- additional countries that are in scope because activity happens there
-- (filming, capture, vendor work, etc.). Each country in scope determines which
-- local data protection regime applies to performer data handled there.
--
-- home_country lives directly on productions for fast lookup; the same country
-- is also seeded as a row in production_countries with is_home=1 so the
-- "Countries in scope" UI can render one unified list (matching the prototype).

ALTER TABLE productions ADD COLUMN home_country TEXT;

CREATE TABLE production_countries (
  id              TEXT    NOT NULL PRIMARY KEY,
  production_id   TEXT    NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  top_level_id    TEXT    NOT NULL,
  is_home         INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'in_scope',
  added_at        INTEGER NOT NULL,
  added_by        TEXT REFERENCES users(id),
  removed_at      INTEGER,
  removed_by      TEXT REFERENCES users(id)
);

CREATE INDEX idx_production_countries_production ON production_countries(production_id);
CREATE UNIQUE INDEX idx_production_countries_home ON production_countries(production_id) WHERE is_home = 1;
