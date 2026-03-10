import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUID
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["talent", "rep", "licensee", "admin"] }).notNull().default("talent"),
  vaultLocked: integer("vault_locked", { mode: "boolean" }).notNull().default(false),
  suspendedAt: integer("suspended_at"), // unix timestamp; null = active
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
  createdAt: integer("created_at").notNull(),   // unix timestamp
  completedAt: integer("completed_at"),         // unix timestamp, set when upload completes
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
  licenceType: text("licence_type", {
    enum: ["film_double", "game_character", "commercial", "ai_avatar", "training_data", "monitoring_reference"],
  }),
  territory: text("territory"),
  exclusivity: text("exclusivity", { enum: ["non_exclusive", "sole", "exclusive"] }).default("non_exclusive"),
  permitAiTraining: integer("permit_ai_training", { mode: "boolean" }).notNull().default(false),
  proposedFee: integer("proposed_fee"),  // pence
  agreedFee: integer("agreed_fee"),      // pence (set on approval)
  platformFee: integer("platform_fee"),  // pence (15% of agreed_fee)
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

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(), // UUID (the token in the invite link)
  email: text("email").notNull(),
  role: text("role", { enum: ["talent", "rep", "licensee"] }).notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  talentId: text("talent_id").references(() => users.id, { onDelete: "cascade" }),
  message: text("message"),
  usedAt: integer("used_at"), // null = not yet used (unix timestamp)
  expiresAt: integer("expires_at").notNull(), // unix timestamp
  createdAt: integer("created_at").notNull(), // unix timestamp
});

export const scanLocations = sqliteTable("scan_locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  hotelImageUrl: text("hotel_image_url"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const scanEvents = sqliteTable("scan_events", {
  id: text("id").primaryKey(),
  locationId: text("location_id").notNull().references(() => scanLocations.id),
  date: integer("date").notNull(),             // unix timestamp (midnight UTC of event day)
  slotDurationMins: integer("slot_duration_mins").notNull().default(90),
  notes: text("notes"),
  status: text("status", { enum: ["open", "full", "cancelled"] }).notNull().default("open"),
  createdAt: integer("created_at").notNull(),
});

export const scanSlots = sqliteTable("scan_slots", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => scanEvents.id, { onDelete: "cascade" }),
  startTime: integer("start_time").notNull(), // unix timestamp
  status: text("status", { enum: ["available", "reserved", "completed", "cancelled"] }).notNull().default("available"),
  createdAt: integer("created_at").notNull(),
});

export const scanBookings = sqliteTable("scan_bookings", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  slotId: text("slot_id").notNull().unique().references(() => scanSlots.id),
  status: text("status", { enum: ["confirmed", "cancelled", "completed"] }).notNull().default("confirmed"),
  notes: text("notes"),
  cancelledAt: integer("cancelled_at"),
  createdAt: integer("created_at").notNull(),
});

export const talentLicencePermissions = sqliteTable("talent_licence_permissions", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  licenceType: text("licence_type", {
    enum: ["commercial", "film_double", "game_character", "ai_avatar", "training_data", "monitoring_reference"],
  }).notNull(),
  permission: text("permission", {
    enum: ["allowed", "approval_required", "blocked"],
  }).notNull().default("approval_required"),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
});

export const pipelineJobs = sqliteTable("pipeline_jobs", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  talentId: text("talent_id").notNull().references(() => users.id),
  initiatedBy: text("initiated_by").notNull().references(() => users.id),
  status: text("status", { enum: ["queued", "processing", "complete", "failed", "cancelled"] })
    .notNull().default("queued"),
  skus: text("skus").notNull().default('["preview","realtime","vfx"]'), // JSON array
  outputR2Prefix: text("output_r2_prefix"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
});

export const pipelineStages = sqliteTable("pipeline_stages", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => pipelineJobs.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), // validate|classify|assemble|bundle|notify
  status: text("status", { enum: ["pending", "running", "complete", "failed", "skipped"] })
    .notNull().default("pending"),
  log: text("log"),
  metadata: text("metadata"), // JSON: stage-specific output data
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
});

export const pipelineOutputs = sqliteTable("pipeline_outputs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => pipelineJobs.id, { onDelete: "cascade" }),
  sku: text("sku", { enum: ["preview", "realtime", "vfx", "training"] }).notNull(),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
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
