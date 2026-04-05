-- Per-user AI feature toggle (admin-controlled)
ALTER TABLE users ADD COLUMN ai_disabled INTEGER NOT NULL DEFAULT 0;
