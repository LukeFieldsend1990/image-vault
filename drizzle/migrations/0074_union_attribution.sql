-- Per-union attribution. Union-subtype compliance grants and union member roster
-- entries were previously union-agnostic — there was no way to tell a SAG watcher
-- from an Equity watcher, or which union a roster name belonged to. Add a union_id
-- to both so attribution is real end-to-end: a watcher granted union_id 'sag_aftra'
-- sees only SAG, and the roster a union manages is its own.
--
-- Nullable on purpose: existing rows predate attribution and have no union to
-- assign. New grants from the admin console require a union; new roster uploads
-- carry the managing union's id.
ALTER TABLE compliance_grants ADD COLUMN union_id TEXT;
ALTER TABLE union_members ADD COLUMN union_id TEXT;

CREATE INDEX idx_compliance_grants_union ON compliance_grants (union_id);
CREATE INDEX idx_union_members_union ON union_members (union_id, archived_at);
