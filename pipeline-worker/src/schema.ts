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
  status: text("status", {
    enum: [
      "AWAITING_PACKAGE",
      "PENDING",
      "APPROVED",
      "DENIED",
      "REVOKED",
      "EXPIRED",
      "SCRUB_PERIOD",
      "CLOSED",
      "OVERDUE",
    ],
  })
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

// Mirror of the app schema's talent_body_profiles — written by the
// derived-stills job's body-metrics pass.
export const talentBodyProfiles = sqliteTable("talent_body_profiles", {
  talentId: text("talent_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => scanPackages.id, { onDelete: "set null" }),
  algorithm: text("algorithm").notNull().default("width-profile-v1"),
  metricsJson: text("metrics_json").notNull(),
  computedAt: integer("computed_at").notNull(),
});

// Mirror of the app schema's derived_render_jobs — the derived-stills job
// records its own progress here.
export const derivedRenderJobs = sqliteTable("derived_render_jobs", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "running", "complete", "failed", "skipped"] })
    .notNull()
    .default("queued"),
  strategy: text("strategy", { enum: ["video_frames", "mesh_turntable"] }),
  stillsCreated: integer("stills_created").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

// Mirror of the app schema's monitor_phash_index — the derived-stills job
// hashes renders it just produced so the monitor's derivation layer covers
// them without a separate sync pass.
export const monitorPhashIndex = sqliteTable("monitor_phash_index", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => scanPackages.id, { onDelete: "cascade" }),
  scanFileId: text("scan_file_id").references(() => scanFiles.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  source: text("source", { enum: ["scan_still", "derived_render"] }).notNull().default("scan_still"),
  algorithm: text("algorithm").notNull().default("dhash-v1"),
  hashHex: text("hash_hex"),
  width: integer("width"),
  height: integer("height"),
  status: text("status", { enum: ["hashed", "failed"] }).notNull().default("hashed"),
  createdAt: integer("created_at").notNull(),
});

// Mirror of the app schema's monitor_reference_images — the probe executor
// reads probe-grade rows to know which vault stills to score generated images
// against. Only the columns the worker needs.
export const monitorReferenceImages = sqliteTable("monitor_reference_images", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  scanFileId: text("scan_file_id").notNull().references(() => scanFiles.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  kind: text("kind", { enum: ["face", "full_body", "unknown"] }).notNull().default("unknown"),
  status: text("status", { enum: ["active", "rejected"] }).notNull().default("active"),
  source: text("source", { enum: ["vault_still", "derived_render"] }).notNull().default("vault_still"),
  probeGrade: integer("probe_grade", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

// Mirror of the app schema's probe_runs / probe_samples / probe_usage — the
// pipeline worker generates + scores samples and checkpoints progress here.
// See lib/db/schema.ts for the authoritative definitions and column docs.
export const probeRuns = sqliteTable("probe_runs", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  hitId: text("hit_id"),
  targetKind: text("target_kind").notNull(),
  targetRef: text("target_ref").notNull(),
  targetFileSha256: text("target_file_sha256"),
  targetMetaJson: text("target_meta_json").notNull().default("{}"),
  protocolJson: text("protocol_json").notNull().default("{}"),
  status: text("status").notNull().default("queued"),
  samplesTotal: integer("samples_total").notNull().default(0),
  samplesGenerated: integer("samples_generated").notNull().default(0),
  samplesScored: integer("samples_scored").notNull().default(0),
  costEstimateUsd: real("cost_estimate_usd").notNull().default(0),
  costActualUsd: real("cost_actual_usd").notNull().default(0),
  manifestR2Key: text("manifest_r2_key"),
  manifestSha256: text("manifest_sha256"),
  verdictJson: text("verdict_json"),
  sealRef: text("seal_ref"),
  error: text("error"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const probeSamples = sqliteTable("probe_samples", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => probeRuns.id, { onDelete: "cascade" }),
  condition: text("condition").notNull(),
  conditionLabel: text("condition_label"),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  seed: integer("seed").notNull(),
  providerPredictionId: text("provider_prediction_id"),
  r2Key: text("r2_key"),
  imageSha256: text("image_sha256"),
  rekognitionSimilarity: real("rekognition_similarity"),
  rekognitionMatches: integer("rekognition_matches"),
  rekognitionUnmatched: integer("rekognition_unmatched"),
  phashHex: text("phash_hex"),
  phashMinDistance: integer("phash_min_distance"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  scoredAt: integer("scored_at"),
});

export const probeUsage = sqliteTable("probe_usage", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  talentId: text("talent_id"),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  units: integer("units").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  costEstimated: integer("cost_estimated", { mode: "boolean" }).notNull().default(false),
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
