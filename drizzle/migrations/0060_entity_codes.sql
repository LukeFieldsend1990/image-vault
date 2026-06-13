-- Entity code decorations ("code view mode").
--
-- System-generated pretty-print codes: AH (talent) / AG (rep) on users, VX/CC/DB/OG
-- on organisations by subtype, PR on productions, and a per-talent scan number on
-- packages (renders as S##). users.show_codes (default 0) is the per-user toggle.
-- Codes are decorators only — never licensing keys.
ALTER TABLE users ADD COLUMN short_code TEXT;
ALTER TABLE users ADD COLUMN show_codes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organisations ADD COLUMN short_code TEXT;
ALTER TABLE productions ADD COLUMN short_code TEXT;
ALTER TABLE scan_packages ADD COLUMN scan_number INTEGER;

-- Backfill existing rows in creation order (rowid). printf('%04d') gives min 4
-- digits and expands naturally (247 -> 0247, 12476 -> 12476).
UPDATE users SET short_code = 'AH-' || printf('%04d',
  (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'talent' AND u2.rowid <= users.rowid))
  WHERE role = 'talent';
UPDATE users SET short_code = 'AG-' || printf('%04d',
  (SELECT COUNT(*) FROM users u2 WHERE u2.role = 'rep' AND u2.rowid <= users.rowid))
  WHERE role = 'rep';

UPDATE organisations SET short_code = 'VX-' || printf('%04d',
  (SELECT COUNT(*) FROM organisations o2 WHERE o2.org_type = 'vfx_vendor' AND o2.rowid <= organisations.rowid))
  WHERE org_type = 'vfx_vendor';
UPDATE organisations SET short_code = 'CC-' || printf('%04d',
  (SELECT COUNT(*) FROM organisations o2 WHERE o2.org_type = 'scan_service' AND o2.rowid <= organisations.rowid))
  WHERE org_type = 'scan_service';
UPDATE organisations SET short_code = 'DB-' || printf('%04d',
  (SELECT COUNT(*) FROM organisations o2 WHERE o2.org_type = 'dubbing' AND o2.rowid <= organisations.rowid))
  WHERE org_type = 'dubbing';
UPDATE organisations SET short_code = 'OG-' || printf('%04d',
  (SELECT COUNT(*) FROM organisations o2 WHERE o2.org_type NOT IN ('vfx_vendor','scan_service','dubbing') AND o2.rowid <= organisations.rowid))
  WHERE org_type NOT IN ('vfx_vendor','scan_service','dubbing');

UPDATE productions SET short_code = 'PR-' || printf('%04d',
  (SELECT COUNT(*) FROM productions p2 WHERE p2.rowid <= productions.rowid));

UPDATE scan_packages SET scan_number =
  (SELECT COUNT(*) FROM scan_packages s2 WHERE s2.talent_id = scan_packages.talent_id AND s2.rowid <= scan_packages.rowid);
