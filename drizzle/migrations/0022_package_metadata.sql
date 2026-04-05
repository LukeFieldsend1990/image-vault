-- Extended metadata for scan packages — all optional, enriched post-upload
ALTER TABLE scan_packages ADD COLUMN scan_type TEXT CHECK(scan_type IN ('light_stage', 'photogrammetry', 'lidar', 'structured_light', 'other'));
ALTER TABLE scan_packages ADD COLUMN resolution TEXT;
ALTER TABLE scan_packages ADD COLUMN polygon_count INTEGER;
ALTER TABLE scan_packages ADD COLUMN color_space TEXT;
ALTER TABLE scan_packages ADD COLUMN has_mesh INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_texture INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_hdr INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_motion_capture INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN compatible_engines TEXT;
ALTER TABLE scan_packages ADD COLUMN tags TEXT;
ALTER TABLE scan_packages ADD COLUMN internal_notes TEXT;
