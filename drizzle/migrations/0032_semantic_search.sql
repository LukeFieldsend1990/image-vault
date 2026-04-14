-- Semantic search: track when each package was last indexed in Vectorize
ALTER TABLE scan_packages ADD COLUMN search_indexed_at INTEGER;

CREATE INDEX idx_packages_search_indexed
  ON scan_packages(search_indexed_at)
  WHERE deleted_at IS NULL AND status = 'ready';
