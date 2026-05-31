import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const scanPackages = sqliteTable("scan_packages", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  status: text("status").notNull().default("uploading"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const scanFiles = sqliteTable("scan_files", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type"),
  uploadStatus: text("upload_status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const licences = sqliteTable("licences", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  packageId: text("package_id"),
  licenseeId: text("licensee_id").notNull(),
  fileScope: text("file_scope").notNull().default("all"),
  status: text("status").notNull().default("PENDING"),
  createdAt: integer("created_at").notNull(),
});

export const geometryFingerprintJobs = sqliteTable("geometry_fingerprint_jobs", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull(),
  packageId: text("package_id").notNull(),
  status: text("status").notNull().default("queued"),
  filesTotal: integer("files_total"),
  filesDone: integer("files_done").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  fileCheckpointJson: text("file_checkpoint_json"),
});

export const geometryFingerprints = sqliteTable("geometry_fingerprints", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  licenceId: text("licence_id").notNull(),
  fileId: text("file_id").notNull(),
  packageId: text("package_id").notNull(),
  licenseeId: text("licensee_id").notNull(),
  watermarkedR2Key: text("watermarked_r2_key").notNull(),
  fingerprintPayloadHash: text("fingerprint_payload_hash").notNull(),
  fingerprintBits: text("fingerprint_bits").notNull(),
  fingerprintBitsLength: integer("fingerprint_bits_length").notNull().default(128),
  repeatFactor: integer("repeat_factor").notNull().default(5),
  watermarkStrength: real("watermark_strength").notNull().default(0.00001),
  watermarkRegionCount: integer("watermark_region_count"),
  fingerprintVersion: integer("fingerprint_version").notNull().default(1),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});
