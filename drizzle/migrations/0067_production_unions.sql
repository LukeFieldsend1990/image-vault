-- Add union affiliation flags to productions
ALTER TABLE productions ADD COLUMN is_sag INTEGER NOT NULL DEFAULT 0;
ALTER TABLE productions ADD COLUMN is_equity INTEGER NOT NULL DEFAULT 0;
