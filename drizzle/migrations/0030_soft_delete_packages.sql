-- Soft-delete support for scan packages
ALTER TABLE scan_packages ADD COLUMN deleted_at INTEGER;
ALTER TABLE scan_packages ADD COLUMN deleted_by TEXT;
