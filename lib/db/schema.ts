import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
