-- Popup locations (seeded with V1 hotels)
CREATE TABLE scan_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  hotel_image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

INSERT INTO scan_locations (id, name, city, address, active, created_at) VALUES
  ('loc-claridges',       'Claridge''s',       'London',        'Brook Street, Mayfair, London W1K 4HR',                         1, unixepoch()),
  ('loc-chateau-marmont', 'Chateau Marmont',   'Los Angeles',   '8221 Sunset Blvd, West Hollywood, CA 90046',                   1, unixepoch()),
  ('loc-the-plaza',       'The Plaza',         'New York City', 'Fifth Avenue at Central Park South, New York, NY 10019',        1, unixepoch());

-- Popup events (a rig visit on a specific date at a location)
CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES scan_locations(id),
  date INTEGER NOT NULL,                   -- unix timestamp (midnight UTC of event day)
  slot_duration_mins INTEGER NOT NULL DEFAULT 90,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','full','cancelled')),
  created_at INTEGER NOT NULL
);

-- Individual time slots per event
CREATE TABLE scan_slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES scan_events(id) ON DELETE CASCADE,
  start_time INTEGER NOT NULL,             -- unix timestamp
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','completed','cancelled')),
  created_at INTEGER NOT NULL
);

-- Talent bookings
CREATE TABLE scan_bookings (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL UNIQUE REFERENCES scan_slots(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','completed')),
  notes TEXT,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL
);
