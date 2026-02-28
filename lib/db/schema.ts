import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUID
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["talent", "rep", "licensee", "admin"] }).notNull().default("talent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const totpCredentials = sqliteTable("totp_credentials", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(), // base32 TOTP secret
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of raw token
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const scanPackages = sqliteTable("scan_packages", {
  id: text("id").primaryKey(), // UUID
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  captureDate: integer("capture_date"), // unix timestamp, nullable
  studioName: text("studio_name"),
  technicianNotes: text("technician_notes"),
  totalSizeBytes: integer("total_size_bytes"), // filled on completion
  status: text("status", { enum: ["uploading", "ready", "error"] }).notNull().default("uploading"),
  createdAt: integer("created_at").notNull(), // unix timestamp
  updatedAt: integer("updated_at").notNull(), // unix timestamp
});

export const scanFiles = sqliteTable("scan_files", {
  id: text("id").primaryKey(), // UUID
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type"),
  uploadStatus: text("upload_status", { enum: ["pending", "uploading", "complete", "error"] }).notNull().default("pending"),
  createdAt: integer("created_at").notNull(), // unix timestamp
});

export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(), // UUID
  scanFileId: text("scan_file_id").notNull().unique().references(() => scanFiles.id, { onDelete: "cascade" }),
  r2UploadId: text("r2_upload_id").notNull(),
  r2Key: text("r2_key").notNull(),
  completedParts: text("completed_parts").notNull().default("[]"), // JSON: [{partNumber, etag}]
  expiresAt: integer("expires_at"), // unix timestamp
  createdAt: integer("created_at").notNull(), // unix timestamp
});

export const licences = sqliteTable("licences", {
  id: text("id").primaryKey(), // UUID
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  licenseeId: text("licensee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  productionCompany: text("production_company").notNull(),
  intendedUse: text("intended_use").notNull(),
  validFrom: integer("valid_from").notNull(), // unix timestamp
  validTo: integer("valid_to").notNull(),     // unix timestamp
  fileScope: text("file_scope").notNull().default("all"), // 'all' or JSON array of file IDs
  status: text("status", { enum: ["PENDING", "APPROVED", "DENIED", "REVOKED", "EXPIRED"] })
    .notNull()
    .default("PENDING"),
  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: integer("approved_at"),
  deniedAt: integer("denied_at"),
  deniedReason: text("denied_reason"),
  revokedAt: integer("revoked_at"),
  downloadCount: integer("download_count").notNull().default(0),
  lastDownloadAt: integer("last_download_at"),
  createdAt: integer("created_at").notNull(),
});

export const talentReps = sqliteTable("talent_reps", {
  id: text("id").primaryKey(), // UUID
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  repId: text("rep_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(), // unix timestamp
});

export const talentProfiles = sqliteTable("talent_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  tmdbId: integer("tmdb_id"),
  profileImageUrl: text("profile_image_url"),
  knownFor: text("known_for").notNull().default("[]"), // JSON: [{title, year, type}]
  popularity: real("popularity"),
  onboardedAt: integer("onboarded_at").notNull(), // unix timestamp
});

export const downloadEvents = sqliteTable("download_events", {
  id: text("id").primaryKey(), // UUID
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "cascade" }), // null for talent's own downloads
  licenseeId: text("licensee_id").notNull().references(() => users.id, { onDelete: "cascade" }), // the user who downloaded
  fileId: text("file_id").notNull().references(() => scanFiles.id, { onDelete: "cascade" }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  bytesTransferred: integer("bytes_transferred"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
});
