-- Add per-user compliance feature toggle (default enabled)
ALTER TABLE users ADD COLUMN compliance_enabled INTEGER NOT NULL DEFAULT 1;
