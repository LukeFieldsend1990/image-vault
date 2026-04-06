-- Per-user toggle for the inbound email intake feature.
-- Default OFF (opt-in, admin enables per user).
ALTER TABLE users ADD COLUMN inbound_enabled INTEGER NOT NULL DEFAULT 0;
