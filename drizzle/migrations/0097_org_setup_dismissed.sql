-- Lets an organisation permanently dismiss the "finish setting up" checklist in
-- the organisations view. Org-level (any owner/admin can dismiss it for the org);
-- once set, the nudge never returns even if items remain incomplete.
ALTER TABLE organisations ADD COLUMN setup_dismissed INTEGER NOT NULL DEFAULT 0;
