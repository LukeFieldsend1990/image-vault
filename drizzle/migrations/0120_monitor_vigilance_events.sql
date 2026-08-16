-- Vigilance events — announcement windows that focus the likeness monitor.
--
-- Synthetic likeness content arrives in waves, and the waves are triggered by
-- public events: a cast reveal, a trailer drop, a premiere. The vocabulary of
-- the wave is the CHARACTER and the PRODUCTION, not the actor's name, which is
-- exactly the vocabulary a name-anchored sweep does not ask for and a
-- name-anchored pre-filter throws away.
--
-- A vigilance event opens a bounded window against a set of personas. While it
-- is open, sweeps for the linked talent add the window's hashtags, accept
-- corroborated character references as an identity match, run on a surge
-- interval, and hand the adjudicator the announcement as context.
--
-- expires_at is NOT NULL by design: an unbounded window is a permanent widening
-- of the paid query set for a news cycle that has ended.

CREATE TABLE monitor_events (
  id               TEXT    PRIMARY KEY,
  kind             TEXT    NOT NULL DEFAULT 'cast_announcement', -- cast_announcement | trailer | premiere | festival | awards | other
  title            TEXT    NOT NULL,
  production_title TEXT,
  source_url       TEXT,
  announced_at     INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active',            -- active | closed
  notes            TEXT,
  created_by       TEXT    REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_monitor_events_open ON monitor_events(status, expires_at);

-- talent_id is nullable: the personas in an announcement are rarely all clients,
-- and the ones who are not are the early warning (and the outreach list). They
-- cannot be swept — detection is anchored to a vault identity — but they are
-- tracked. person_slug is the auto-link key against talent_profiles.full_name.
CREATE TABLE monitor_event_personas (
  id               TEXT    PRIMARY KEY,
  event_id         TEXT    NOT NULL REFERENCES monitor_events(id) ON DELETE CASCADE,
  person_name      TEXT    NOT NULL,
  person_slug      TEXT    NOT NULL,
  character_name   TEXT,
  extra_terms_json TEXT    NOT NULL DEFAULT '[]',
  talent_id        TEXT    REFERENCES users(id) ON DELETE SET NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event_id, person_slug)
);

CREATE INDEX idx_monitor_event_personas_slug ON monitor_event_personas(person_slug);
CREATE INDEX idx_monitor_event_personas_talent ON monitor_event_personas(talent_id);

-- Which window was open when a hit was detected. Attribution by window rather
-- than by caption: the question it answers is "what did this announcement cost
-- this talent", which is what justifies the extra sweep spend. No FK — a hit
-- must outlive the cleanup of a stale event row.
ALTER TABLE likeness_hits ADD COLUMN vigilance_event_id TEXT;

CREATE INDEX idx_likeness_hits_vigilance ON likeness_hits(vigilance_event_id);

-- ── Seed: X-Men cast announcement ───────────────────────────────────────────
-- Announced 2026-08-15. Sixty-day window, peak for the first fortnight.
-- Personas are editable from /admin/monitor; unlinked ones become sweepable the
-- moment a talent profile with a matching name exists.
INSERT OR IGNORE INTO monitor_events
  (id, kind, title, production_title, announced_at, expires_at, status, notes, created_at, updated_at)
VALUES (
  '53f58305-ac02-40fa-b8d6-2d01c20a4442',
  'cast_announcement',
  'X-Men cast announcement',
  'X-Men',
  1786795200,
  1791979200,
  'active',
  'Principal cast revealed at the Marvel conference. Expect a surge of recast/fancast synthetic content tagged by character rather than by actor.',
  1786795200,
  1786795200
);

INSERT OR IGNORE INTO monitor_event_personas
  (id, event_id, person_name, person_slug, character_name, extra_terms_json, active)
VALUES
  ('2f0eafd0-d655-44ce-89b6-278b2c9ba81f', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Kit Connor',         'kitconnor',         'Scott Summers/Cyclops',          '[]', 1),
  ('11427f83-109a-4071-8256-abfe00b85bc3', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Sadie Sink',         'sadiesink',         'Jean Grey',                      '["phoenix"]', 1),
  ('d2702223-079f-410f-a77c-b9be8af68e1b', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Christopher Abbott', 'christopherabbott', 'Charles Xavier/Professor X',     '[]', 1),
  -- Both spellings of the surname circulate in the trades; the variant is swept
  -- as an extra term so a misspelled hashtag is not a coverage hole.
  ('16406a36-a3c8-4882-bdf7-3c101e65a846', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Inde Navarrette',    'indenavarrette',    'Anna Marie/Rogue',               '["indenavarette"]', 1),
  ('5c4bde62-ab19-41e2-87e1-704d647d29b2', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Maya Boyd',          'mayaboyd',          'Ororo Munroe/Storm',             '[]', 1),
  ('43a7255a-ecbc-491b-9e94-b31391541fce', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Samara Weaving',     'samaraweaving',     'Emma Frost',                     '["whitequeen"]', 1),
  -- Announced as Milbury; Essex is the same character's other name and is the
  -- one the fandom tags, so both go in.
  ('0200056e-6293-47b3-a352-71c8b4538d07', '53f58305-ac02-40fa-b8d6-2d01c20a4442', 'Adam Driver',        'adamdriver',        'Nathaniel Milbury/Mister Sinister', '["mrsinister","nathanielessex"]', 1);
