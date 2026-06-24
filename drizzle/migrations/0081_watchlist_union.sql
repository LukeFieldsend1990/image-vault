-- Per-union watchlist attribution. The production watchlist was union-agnostic —
-- a SAG and an Equity watcher saw the same list. Add a union_id so each union's
-- list is its own (mirrors union_members in 0074_union_attribution).
--
-- Nullable on purpose: existing rows predate attribution. New entries from a
-- union watcher carry their union id; admins may pick any.
ALTER TABLE production_watchlist ADD COLUMN union_id TEXT;

CREATE INDEX idx_production_watchlist_union ON production_watchlist (union_id, archived_at);
