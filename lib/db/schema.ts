import { sqliteTable, text, integer, real, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { ORG_TYPES } from "@/lib/organisations/orgTypes";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // UUID
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // "licensee" retained for the transition window; new accounts use "industry". Gate via isIndustryRole().
  // "compliance" = read-only Union/Regulator/Insurer watcher (no data-plane access).
  role: text("role", { enum: ["talent", "rep", "industry", "licensee", "compliance", "admin"] }).notNull().default("talent"),
  vaultLocked: integer("vault_locked", { mode: "boolean" }).notNull().default(false),
  suspendedAt: integer("suspended_at"), // unix timestamp; null = active
  phone: text("phone"), // optional, E.164 format
  emailMuted: integer("email_muted", { mode: "boolean" }).notNull().default(false),
  aiDisabled: integer("ai_disabled", { mode: "boolean" }).notNull().default(false),
  inboundEnabled: integer("inbound_enabled", { mode: "boolean" }).notNull().default(false),
  geoFingerprintEnabled: integer("geo_fingerprint_enabled", { mode: "boolean" }).notNull().default(false),
  royaltyMeterEnabled: integer("royalty_meter_enabled", { mode: "boolean" }).notNull().default(false),
  complianceEnabled: integer("compliance_enabled", { mode: "boolean" }).notNull().default(true),
  // Gates whether the talent sees the (under-test) upfront fee model. Off by default.
  financialVisibilityEnabled: integer("financial_visibility_enabled", { mode: "boolean" }).notNull().default(false),
  // Pretty-print code (AH-#### talent, AG-#### rep). System-generated; see lib/codes.
  shortCode: text("short_code"),
  // Per-user "code view mode" — decorate the UI with system codes. Off by default.
  showCodes: integer("show_codes", { mode: "boolean" }).notNull().default(false),
  // Stores the actual role for industry/compliance users. users.role is constrained
  // to legacy values by a CHECK that cannot be removed in D1 without recreating
  // the table. Effective role = trueRole ?? role. NULL for talent/rep/admin/licensee.
  trueRole: text("true_role"),
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

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(), // unix timestamp
  usedAt: integer("used_at"), // unix timestamp; null until consumed
  createdAt: integer("created_at").notNull(), // unix timestamp
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
  coverImageKey: text("cover_image_key"),
  // Extended metadata (enriched post-upload)
  scanType: text("scan_type", { enum: ["light_stage", "photogrammetry", "lidar", "structured_light", "other"] }),
  resolution: text("resolution"),
  polygonCount: integer("polygon_count"),
  colorSpace: text("color_space"),
  hasMesh: integer("has_mesh", { mode: "boolean" }).default(false),
  hasTexture: integer("has_texture", { mode: "boolean" }).default(false),
  hasHdr: integer("has_hdr", { mode: "boolean" }).default(false),
  hasMotionCapture: integer("has_motion_capture", { mode: "boolean" }).default(false),
  compatibleEngines: text("compatible_engines"), // JSON: ["unreal", "unity", "maya", "blender"]
  tags: text("tags"), // JSON: ["full_body", "face_only", "hands"]
  internalNotes: text("internal_notes"),
  createdAt: integer("created_at").notNull(), // unix timestamp
  updatedAt: integer("updated_at").notNull(), // unix timestamp
  deletedAt: integer("deleted_at"),           // unix timestamp; null = active
  deletedBy: text("deleted_by"),              // user ID who soft-deleted
  searchIndexedAt: integer("search_indexed_at"), // last Vectorize index timestamp
  scanNumber: integer("scan_number"), // sequential per talent → renders as S## in the chain code
});

export const scanFiles = sqliteTable("scan_files", {
  id: text("id").primaryKey(), // UUID
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type"),
  uploadStatus: text("upload_status", { enum: ["pending", "uploading", "complete", "error"] }).notNull().default("pending"),
  sha256: text("sha256"),                       // hex SHA-256, populated at upload completion or on-demand
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
  shortCode: text("short_code"), // LC-#### public reference. System-generated; see lib/codes.
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => scanPackages.id, { onDelete: "cascade" }),
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
  // Multi-select use types (item 7). JSON array of the same enum values as
  // licenceType. licenceType above is kept populated with the primary (first)
  // selection for back-compat; this array is the full set the licence covers.
  // One licence row carries the array — no per-type contract fan-out.
  licenceTypesJson: text("licence_types_json"),
  // Re-licence flag (item 9): true when this is a re-licence of an existing scan
  // (a fee is expected) rather than a fresh production scan. Distinct from
  // productionIncluded (£0, paid as part of the production).
  isRelicense: integer("is_relicense", { mode: "boolean" }),
  territory: text("territory"),
  exclusivity: text("exclusivity", { enum: ["non_exclusive", "sole", "exclusive"] }).default("non_exclusive"),
  permitAiTraining: integer("permit_ai_training", { mode: "boolean" }).notNull().default(false),
  // Canonical use-category ids (lib/consent/use-categories.ts) as a JSON array.
  // intendedUse above stays free-text for notes; this is the structured vocabulary.
  useCategoriesJson: text("use_categories_json"),
  proposedFee: integer("proposed_fee"),  // cents
  agreedFee: integer("agreed_fee"),      // cents (set on approval)
  platformFee: integer("platform_fee"),  // cents (15% of agreed_fee)
  downloadCount: integer("download_count").notNull().default(0),
  lastDownloadAt: integer("last_download_at"),
  deliveryMode: text("delivery_mode", { enum: ["standard", "bridge_only"] }).notNull().default("standard"),
  // Pre-authorisation: talent (or rep-confirmed) blanket approval for future downloads
  preauthUntil: integer("preauth_until"),   // unix timestamp; null = no active pre-auth
  preauthSetBy: text("preauth_set_by").references(() => users.id), // who set it
  productionId: text("production_id").references(() => productions.id),
  productionCompanyId: text("production_company_id").references(() => productionCompanies.id),
  organisationId: text("organisation_id").references(() => organisations.id),
  contractUrl: text("contract_url"), // R2 object key: contracts/{licenceId}/{filename}
  contractUploadedAt: integer("contract_uploaded_at"),
  contractUploadedBy: text("contract_uploaded_by").references(() => users.id),
  scrubDeadline: integer("scrub_deadline"),
  scrubAttestedAt: integer("scrub_attested_at"),
  // Per-unit royalty rate proposed by licensee (AI/avatar licences); accepted by talent on approval.
  proposedUnitType: text("proposed_unit_type"),
  proposedUnitRatePence: integer("proposed_unit_rate_pence"),
  agreedUnitType: text("agreed_unit_type"),
  agreedUnitRatePence: integer("agreed_unit_rate_pence"),
  // Production-included: the scan was commissioned and paid for as part of the
  // production, so the licence fee is £0 and it does NOT count as a re-licence.
  productionIncluded: integer("production_included", { mode: "boolean" }).notNull().default(false),
  inclusionReason: text("inclusion_reason"),
  inclusionMarkedBy: text("inclusion_marked_by").references(() => users.id),
  inclusionMarkedAt: integer("inclusion_marked_at"),
  createdAt: integer("created_at").notNull(),
});

export const scrubAttestations = sqliteTable("scrub_attestations", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  attestedBy: text("attested_by").notNull().references(() => users.id),
  attestedAt: integer("attested_at").notNull(),
  attestationText: text("attestation_text").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  devicesScrubbed: text("devices_scrubbed"), // JSON array of device descriptors
  bridgeCachePurged: integer("bridge_cache_purged", { mode: "boolean" }).notNull().default(false),
  additionalNotes: text("additional_notes"),
  createdAt: integer("created_at").notNull(),
});

export const talentReps = sqliteTable("talent_reps", {
  id: text("id").primaryKey(), // UUID
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  repId: text("rep_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(), // unix timestamp
  // The agency org this rep acts under, if any. Routing key for the agent inbox
  // (#1): requests for this performer route to this agency. Nullable — legacy /
  // unaffiliated reps have no agency and can be attached later by an admin.
  agencyOrgId: text("agency_org_id").references(() => organisations.id, { onDelete: "set null" }),
});

export const talentProfiles = sqliteTable("talent_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  tmdbId: integer("tmdb_id"),
  profileImageUrl: text("profile_image_url"),
  knownFor: text("known_for").notNull().default("[]"), // JSON: [{title, year, type}]
  popularity: real("popularity"),
  onboardedAt: integer("onboarded_at").notNull(), // unix timestamp
  pitchVignettesEnabled: integer("pitch_vignettes_enabled", { mode: "boolean" }).notNull().default(false),
  unionAffiliation: text("union_affiliation"), // self-declared: "SAG-AFTRA", "Equity", free text, or null
});

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(), // UUID (the token in the invite link)
  email: text("email").notNull(),
  role: text("role", { enum: ["talent", "rep", "industry", "licensee", "compliance"] }).notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  talentId: text("talent_id").references(() => users.id, { onDelete: "cascade" }),
  message: text("message"),
  usedAt: integer("used_at"), // null = not yet used (unix timestamp)
  expiresAt: integer("expires_at").notNull(), // unix timestamp
  createdAt: integer("created_at").notNull(), // unix timestamp
  productionId: text("production_id").references(() => productions.id),
  orgSubtype: text("org_subtype"), // industry: intended OrgType; compliance: subtype (union|regulator|insurer)
  unionId: text("union_id"), // compliance union invites: which union (sag_aftra|equity) the auto-grant attributes to
  castId: text("cast_id"), // Path C: rep invite scoped to a specific cast slot
  // Admin concierge invite: the org the invitee should be made owner of on signup
  // (the production was pre-built by an admin under this org).
  organisationId: text("organisation_id"),
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

export const talentSettings = sqliteTable("talent_settings", {
  talentId: text("talent_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  pipelineEnabled: integer("pipeline_enabled", { mode: "boolean" }).notNull().default(false),
  talentSharePct: integer("talent_share_pct").notNull().default(80),
  agencySharePct: integer("agency_share_pct").notNull().default(10),
  platformSharePct: integer("platform_share_pct").notNull().default(10),
  // Upfront tier assignment — see lib/financial/config.ts (emerging | established | a_list | bespoke).
  tier: text("tier"),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
});

// Upfront fee obligations (talent tier fee + production banded access fee).
export const feeObligations = sqliteTable("fee_obligations", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["talent_tier", "production_access"] }).notNull(),
  // Who is billed: the talent (tier) or the licensee user (production access).
  payerUserId: text("payer_user_id").references(() => users.id, { onDelete: "set null" }),
  talentId: text("talent_id").references(() => users.id, { onDelete: "set null" }),
  productionId: text("production_id").references(() => productions.id, { onDelete: "set null" }),
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "set null" }),
  tier: text("tier"),   // for talent_tier
  band: text("band"),   // for production_access
  amountCents: integer("amount_cents"), // null = bespoke / TBD
  currency: text("currency").notNull().default("usd"),
  status: text("status", { enum: ["pending", "paid", "waived", "cancelled"] }).notNull().default("pending"),
  graceDeadline: integer("grace_deadline"), // unix seconds; null = no deadline set
  notes: text("notes"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: integer("created_at").notNull(),
  paidAt: integer("paid_at"),
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

// ── Production entities ──────────────────────────────────────────────────────

export const productionCompanies = sqliteTable("production_companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const productions = sqliteTable("productions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  companyId: text("company_id").references(() => productionCompanies.id),
  type: text("type", { enum: ["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"] }),
  year: integer("year"),
  status: text("status", { enum: ["development", "pre_production", "production", "post_production", "released", "cancelled"] }),
  imdbId: text("imdb_id"),
  tmdbId: integer("tmdb_id"),
  director: text("director"),
  vfxSupervisor: text("vfx_supervisor"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  organisationId: text("organisation_id").references(() => organisations.id),
  coordinatorId: text("coordinator_id").references(() => users.id),
  sagProjectNumber: text("sag_project_number"),
  isSag: integer("is_sag", { mode: "boolean" }).notNull().default(false),
  isEquity: integer("is_equity", { mode: "boolean" }).notNull().default(false),
  otherUnion: text("other_union"), // free-text "Other" union when a title falls outside SAG-AFTRA / Equity
  shortCode: text("short_code"), // PR-#### production code. System-generated; see lib/codes.
  // Home jurisdiction — the country the production company is registered in.
  // Set during setup; additional countries the show operates in live in
  // production_countries. Mirrored as the is_home=1 row there so the UI
  // renders one unified list.
  homeCountry: text("home_country"),
});

// Countries in scope for a production — every place data activity (filming,
// capture, vendor processing) happens. One row per jurisdiction. Removing a
// country is a soft-delete (status='removed' + removedAt) so the compliance
// audit trail survives. The home country sits here too with is_home=1.
export const productionCountries = sqliteTable("production_countries", {
  id: text("id").primaryKey(),
  productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  topLevelId: text("top_level_id").notNull(), // 'UK' | 'EU' | 'US' | 'CH' | 'CA' | ...
  isHome: integer("is_home", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["in_scope", "removed"] }).notNull().default("in_scope"),
  addedAt: integer("added_at").notNull(),
  addedBy: text("added_by").references(() => users.id),
  removedAt: integer("removed_at"),
  removedBy: text("removed_by").references(() => users.id),
  // Set when the row was auto-added because a vendor org with this country was
  // attached to the production. Auto-removal on vendor detach only considers
  // rows with this set; manually-added countries stay regardless.
  addedViaVendorId: text("added_via_vendor_id"),
});

// Upcoming productions believed to be heading into pre-production that are NOT yet
// ratified on Image Vault. Gives the union read visibility (and an outreach flag)
// without mandating onboarding. "Ratified" is derived at read time by matching
// tmdbId / name against `productions`, never stored.
export const productionWatchlist = sqliteTable("production_watchlist", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  companyName: text("company_name"),
  tmdbId: integer("tmdb_id"),
  type: text("type", { enum: ["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"] }),
  expectedStage: text("expected_stage", { enum: ["development", "pre_production", "production", "unknown"] }).notNull().default("pre_production"),
  expectedStartDate: integer("expected_start_date"),
  source: text("source", { enum: ["tmdb", "manual"] }).notNull().default("manual"),
  notes: text("notes"),
  flaggedForOutreach: integer("flagged_for_outreach", { mode: "boolean" }).notNull().default(false),
  outreachNotes: text("outreach_notes"),
  addedBy: text("added_by").notNull().references(() => users.id),
  addedAt: integer("added_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  archivedAt: integer("archived_at"),
  // Which union this entry belongs to (e.g. "sag_aftra" | "equity"). Null for
  // legacy rows added before per-union attribution.
  unionId: text("union_id"),
});

// Union member roster: a union's membership list (plain names), so it can see which
// members are already on Image Vault. Visibility only — onboarding is not mandated.
// "On platform" is derived at read time by matching against talent profiles.
export const unionMembers = sqliteTable("union_members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Which union this roster entry belongs to (e.g. "sag_aftra" | "equity"). Null
  // for legacy rows added before per-union attribution.
  unionId: text("union_id"),
  addedBy: text("added_by").notNull().references(() => users.id),
  addedAt: integer("added_at").notNull(),
  archivedAt: integer("archived_at"),
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

// ── Bridge tables ─────────────────────────────────────────────────────────────

export const bridgeTokens = sqliteTable("bridge_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  displayName: text("display_name").notNull(),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});

export const bridgeDevices = sqliteTable("bridge_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  displayName: text("display_name").notNull(),
  lastSeenAt: integer("last_seen_at"),
  createdAt: integer("created_at").notNull(),
});

export const bridgeGrants = sqliteTable("bridge_grants", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id),
  packageId: text("package_id").notNull().references(() => scanPackages.id),
  userId: text("user_id").notNull().references(() => users.id),
  tool: text("tool").notNull(),
  deviceId: text("device_id").notNull(),
  allowedTools: text("allowed_tools").notNull().default("[]"), // JSON array
  manifestJson: text("manifest_json").notNull(),
  signature: text("signature").notNull(),
  keyId: text("key_id").notNull().default("bridge-signing-key-1"),
  expiresAt: integer("expires_at").notNull(),    // licences.validTo
  offlineUntil: integer("offline_until").notNull(), // expiresAt + 48h grace
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
  purgeRequestedAt: integer("purge_requested_at"),
  purgeCompletedAt: integer("purge_completed_at"),
});

// ── Site-wide settings ────────────────────────────────────────────────────────

export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
});

// ── AI tables ────────────────────────────────────────────────────────────────

export const aiSettings = sqliteTable("ai_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
});

export const suggestions = sqliteTable("suggestions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // action_required | attention | insight | security
  feature: text("feature").notNull(), // suggestions | fee_guidance | security_alerts
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link"),
  entityType: text("entity_type"), // licence | package | talent | download
  entityId: text("entity_id"),
  priority: integer("priority").notNull().default(50),
  acknowledgedAt: integer("acknowledged_at"),
  clickedAt: integer("clicked_at"),
  expiresAt: integer("expires_at").notNull(),
  batchId: text("batch_id"),
  createdAt: integer("created_at").notNull(),
});

export const packageTags = sqliteTable("package_tags", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
  category: text("category").notNull(), // scan_type | quality | compatibility | completeness
  status: text("status").notNull().default("suggested"), // suggested | accepted | dismissed
  suggestedBy: text("suggested_by").notNull().default("ai"), // ai | user
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
});

export const aiCostLog = sqliteTable("ai_cost_log", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(), // workers_ai | anthropic
  model: text("model").notNull(),
  feature: text("feature").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  error: text("error"),
  prompt: text("prompt"),
  response: text("response"),
  createdAt: integer("created_at").notNull(),
});

export const aiBatchRuns = sqliteTable("ai_batch_runs", {
  id: text("id").primaryKey(),
  triggerType: text("trigger_type").notNull(), // manual | scheduled
  status: text("status").notNull(), // started | completed | failed
  initiatedByUserId: text("initiated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  initiatedByEmail: text("initiated_by_email"),
  repsTargeted: integer("reps_targeted"),
  repsProcessed: integer("reps_processed"),
  suggestionsCreated: integer("suggestions_created").notNull().default(0),
  skipped: text("skipped"), // JSON array
  error: text("error"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  updatedAt: integer("updated_at").notNull(),
});

// ── Bridge tables ─────────────────────────────────────────────────────────────

export const bridgeEvents = sqliteTable("bridge_events", {
  id: text("id").primaryKey(),
  grantId: text("grant_id").references(() => bridgeGrants.id),
  packageId: text("package_id").notNull(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id"),
  eventType: text("event_type").notNull(), // tamper_detected|unexpected_copy|hash_mismatch|lease_expired|cache_purged|open_denied|purge_started|purge_partial|file_in_use|purge_stalled|purge_failed|file_removed_from_cache|re_access_denied|agent_enrolled|agent_online|agent_purge_complete|agent_publish_complete|agent_revoked
  severity: text("severity").notNull().default("warn"), // info|warn|critical
  detail: text("detail"), // JSON blob
  createdAt: integer("created_at").notNull(),
});

// ── Access windows — time-boxed download access ─────────────────────────────

export const accessWindows = sqliteTable("access_windows", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  talentId: text("talent_id").notNull().references(() => users.id),
  licenseeId: text("licensee_id").notNull().references(() => users.id),
  openedBy: text("opened_by").notNull().references(() => users.id),
  openedAt: integer("opened_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  maxDownloads: integer("max_downloads").notNull().default(50),
  downloadsUsed: integer("downloads_used").notNull().default(0),
  status: text("status", { enum: ["active", "closed", "expired", "exhausted"] }).notNull().default("active"),
  closedBy: text("closed_by").references(() => users.id),
  closedAt: integer("closed_at"),
  closeReason: text("close_reason"),
  createdAt: integer("created_at").notNull(),
});

export const accessWindowEvents = sqliteTable("access_window_events", {
  id: text("id").primaryKey(),
  windowId: text("window_id").notNull().references(() => accessWindows.id, { onDelete: "cascade" }),
  eventType: text("event_type", {
    enum: ["opened", "download", "extended", "closed", "expired", "exhausted"],
  }).notNull(),
  actorId: text("actor_id").references(() => users.id),
  metadata: text("metadata"), // JSON blob
  createdAt: integer("created_at").notNull(),
});

// ── Inbound email intake ─────────────────────────────────────────────────────

export const inboundAliases = sqliteTable("inbound_aliases", {
  id: text("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  aliasType: text("alias_type", { enum: ["user", "licence", "package", "talent"] }).notNull().default("user"),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ownerEntityId: text("owner_entity_id"),
  status: text("status", { enum: ["active", "revoked", "expired"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
  lastUsedAt: integer("last_used_at"),
});

export const receivedEmails = sqliteTable("received_emails", {
  id: text("id").primaryKey(),
  resendEmailId: text("resend_email_id").unique(),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  references: text("references"), // JSON array of Message-IDs
  aliasId: text("alias_id").references(() => inboundAliases.id, { onDelete: "set null" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  ownerEntityId: text("owner_entity_id"),
  fromName: text("from_name"),
  fromEmail: text("from_email").notNull(),
  subject: text("subject"),
  sentAt: integer("sent_at"),
  receivedAt: integer("received_at").notNull(),
  textBody: text("text_body"),
  htmlBody: text("html_body"),
  normalizedText: text("normalized_text"),
  rawHeadersJson: text("raw_headers_json"),
  spamScore: real("spam_score"),
  processingStatus: text("processing_status", {
    enum: ["pending", "fetching", "processing", "triaged", "failed"],
  }).notNull().default("pending"),
  routingStatus: text("routing_status", {
    enum: ["matched", "unmatched", "quarantine"],
  }).notNull().default("matched"),
  dedupeKey: text("dedupe_key"),
  threadKey: text("thread_key"),
  createdAt: integer("created_at").notNull(),
});

export const receivedEmailRecipients = sqliteTable("received_email_recipients", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull().references(() => receivedEmails.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["to", "cc", "bcc"] }).notNull(),
  displayName: text("display_name"),
  address: text("address").notNull(),
});

export const receivedEmailAttachments = sqliteTable("received_email_attachments", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull().references(() => receivedEmails.id, { onDelete: "cascade" }),
  filename: text("filename"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  storageKey: text("storage_key"),
  checksum: text("checksum"),
  scanStatus: text("scan_status", { enum: ["pending", "clean", "suspicious", "blocked"] }).notNull().default("pending"),
  textExtractionStatus: text("text_extraction_status", {
    enum: ["pending", "done", "failed", "skipped"],
  }).notNull().default("pending"),
  extractedText: text("extracted_text"),
  createdAt: integer("created_at").notNull(),
});

export const aiTriageResults = sqliteTable("ai_triage_results", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull().references(() => receivedEmails.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  promptVersion: text("prompt_version").notNull().default("v1"),
  summary: text("summary"),
  category: text("category"),
  urgency: text("urgency", { enum: ["low", "medium", "high", "critical"] }),
  confidence: real("confidence"),
  structuredDataJson: text("structured_data_json"),
  recommendedAction: text("recommended_action"),
  riskFlagsJson: text("risk_flags_json"),
  reviewStatus: text("review_status", {
    enum: ["pending", "approved", "rejected", "auto_applied"],
  }).notNull().default("pending"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
});

export const skillExecutions = sqliteTable("skill_executions", {
  id: text("id").primaryKey(),
  skillId: text("skill_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id),
  emailId: text("email_id").references(() => receivedEmails.id, { onDelete: "set null" }),
  success: integer("success", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const emailThreadLinks = sqliteTable("email_thread_links", {
  id: text("id").primaryKey(),
  ownerEntityId: text("owner_entity_id"),
  threadKey: text("thread_key").notNull().unique(),
  latestEmailId: text("latest_email_id").references(() => receivedEmails.id, { onDelete: "set null" }),
  emailCount: integer("email_count").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

// ── Production organisations (auth-connected) ────────────────────────────────

export const organisations = sqliteTable("organisations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  website: text("website"),
  billingEmail: text("billing_email"),
  productionCompanyId: text("production_company_id").references(() => productionCompanies.id),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  // Subtype decoration — see lib/organisations/orgTypes.ts (single source of truth).
  orgType: text("org_type", { enum: ORG_TYPES }).notNull().default("production_company"),
  // Environment-audit gate for vendor ("mover") orgs — admin-togglable; gates Bridge provisioning.
  vendorAuditPassed: integer("vendor_audit_passed", { mode: "boolean" }).notNull().default(false),
  // Pretty-print code by subtype (VX vfx_vendor, CC scan_service, DB dubbing, OG other). System-generated.
  shortCode: text("short_code"),
  // Country the org is registered in. Two-part shape mirrors production_countries:
  // `countryTopLevelId` ('UK' | 'EU' | 'US' | 'CH' | ...) names the jurisdiction
  // regime; `country` is the human-readable country/region (e.g. "Germany",
  // "California"). Collected at onboarding; existing rows backfilled to UK.
  country: text("country"),
  countryTopLevelId: text("country_top_level_id"),
  // Owner-only toggle. When true, every org owner gets implicit full access to
  // every production the org owns (legacy behaviour). When false (default), only
  // a production's owner reaches it unless colleagues are explicitly added.
  ownerImplicitAccess: integer("owner_implicit_access", { mode: "boolean" }).notNull().default(false),
});

export const organisationMembers = sqliteTable("organisation_members", {
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  memberRole: text("member_role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  invitedBy: text("invited_by").references(() => users.id),
  joinedAt: integer("joined_at").notNull(),
});

export const organisationInvites = sqliteTable("organisation_invites", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
  acceptedAt: integer("accepted_at"),
  createdAt: integer("created_at").notNull(),
});

// ── Scan transfers (capture-company upload-on-behalf) ─────────────────────────
// A scan_service / vendor org uploads a package either into a talent's vault
// (to_talent) or against a production licence's pending scan (to_licence). The
// staged package is owned by the uploading org member until the transfer is
// accepted, at which point ownership reassigns to the target talent.
export const scanTransfers = sqliteTable("scan_transfers", {
  id: text("id").primaryKey(),
  fromOrgId: text("from_org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  transferType: text("transfer_type", { enum: ["to_talent", "to_licence"] }).notNull(),
  // Target talent — set directly for to_talent, derived from the licence for to_licence.
  toTalentId: text("to_talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetLicenceId: text("target_licence_id").references(() => licences.id, { onDelete: "set null" }),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  lookLabel: text("look_label"), // human-readable look name, e.g. "Base Look"
  status: text("status", {
    enum: ["pending", "submitted", "accepted", "rejected", "cancelled"],
  }).notNull().default("pending"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  submittedAt: integer("submitted_at"),
  decidedAt: integer("decided_at"),
  decidedBy: text("decided_by").references(() => users.id),
});

// ── Vendor authorisations (producer → vendor access within a licence) ─────────
// A production (the licence holder) authorises specific vendor orgs to pull the
// licensed scan via the Bridge, bounded by the licence's type/time. An
// authorised vendor can nominate a sub-vendor under its own authorisation
// (parentAuthorisationId set, nominatedByOrgId = the parent vendor org).
export const vendorAuthorisations = sqliteTable("vendor_authorisations", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  vendorOrgId: text("vendor_org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  // null = direct production→vendor; set = sub-vendor nominated under the parent auth (plain id, app-enforced).
  parentAuthorisationId: text("parent_authorisation_id"),
  nominatedByOrgId: text("nominated_by_org_id").references(() => organisations.id),
  authorisedBy: text("authorised_by").notNull().references(() => users.id),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
  revokedBy: text("revoked_by").references(() => users.id),
});

// ── Render-bridge agents ──────────────────────────────────────────────────────

export const renderBridgeAgents = sqliteTable("render_bridge_agents", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id),
  productionId: text("production_id").references(() => productions.id),
  displayName: text("display_name").notNull(),
  serviceTokenHash: text("service_token_hash"),       // SHA-256; null until enrolment completes
  tokenExpiresAt: integer("token_expires_at"),         // unix timestamp
  status: text("status", { enum: ["active", "revoked", "expired"] }).notNull().default("active"),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  publishedPackagesJson: text("published_packages_json").notNull().default("[]"),
  pendingAction: text("pending_action"),               // null | purge | publish | rotate-token
  buildRevision: text("build_revision"),               // git SHA from heartbeat; null = pre-versioning container
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

// Bridge setup attestations — audit-logged human sign-offs during guided Bridge
// setup. "local_access" records that the vendor confirmed their proxy folder is
// secured per the network rules; "bridge_live" is the final go-live sign-off.
// Multiple rows are allowed (re-attestation history); the latest per (org, kind)
// is authoritative. These are the liability anchor if a vendor leaks data later.
export const bridgeAttestations = sqliteTable("bridge_attestations", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  attestedByUserId: text("attested_by_user_id").notNull().references(() => users.id),
  kind: text("kind", { enum: ["local_access", "bridge_live"] }).notNull(),
  statementVersion: text("statement_version").notNull(),
  attestedAt: integer("attested_at").notNull(),
});

// ── Geometric fingerprinting ──────────────────────────────────────────────────

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
  fileCheckpointJson: text("file_checkpoint_json"), // resumable pass-2 state, cleared on completion
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

// ── Live Royalty Meter ─────────────────────────────────────────────────────────
// Pay-as-you-go likeness usage: a studio / AI company holds a royalty source key
// scoped to a licence and POSTs a usage event each time the talent's likeness
// drives a generation. Each event accrues a per-use royalty, split via
// talent_settings. See SPEC §15.

export const royaltySources = sqliteTable("royalty_sources", {
  id: text("id").primaryKey(), // UUID
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  organisationId: text("organisation_id").references(() => organisations.id), // optional org scope
  displayName: text("display_name").notNull(), // e.g. "Pixel Forge VFX — Unreal pipeline"
  apiKeyHash: text("api_key_hash").notNull().unique(), // SHA-256 of raw rsk_ key
  unitType: text("unit_type", {
    enum: ["per_generation", "per_1k_inferences", "per_frame", "per_second"],
  }).notNull().default("per_generation"),
  unitRatePence: integer("unit_rate_pence").notNull(), // server-trusted price per unit
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by").references(() => users.id),
  revokedAt: integer("revoked_at"),
});

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(), // UUID
  sourceId: text("source_id").notNull().references(() => royaltySources.id, { onDelete: "cascade" }),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // mirrors source unit_type at event time
  units: integer("units").notNull(),
  unitRatePence: integer("unit_rate_pence").notNull(), // snapshot of rate at event time
  grossPence: integer("gross_pence").notNull(),    // units × unit_rate_pence
  talentPence: integer("talent_pence").notNull(),
  agencyPence: integer("agency_pence").notNull(),
  platformPence: integer("platform_pence").notNull(),
  externalRef: text("external_ref"), // caller's generation/run id — idempotency key
  detailJson: text("detail_json"),    // JSON: { modelId?, shotId?, ... } (untrusted)
  occurredAt: integer("occurred_at").notNull(), // caller-supplied event time
  recordedAt: integer("recorded_at").notNull(), // server receipt time
});

// ── Compliance Layer (SPEC §16) — SAG-AFTRA Article 39 + multi-regime ledger ──

export const complianceEvents = sqliteTable("compliance_events", {
  id: text("id").primaryKey(), // UUID
  chainKey: text("chain_key").notNull(),     // 'licence:{id}' | 'talent:{id}'
  seq: integer("seq").notNull(),             // monotonic within chain_key
  eventType: text("event_type").notNull(),   // consent.granted | strike.declared | ...
  regime: text("regime").notNull().default("sag_aftra"),
  clauseRef: text("clause_ref"),             // e.g. '39.D'
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "cascade" }),
  talentId: text("talent_id").references(() => users.id, { onDelete: "cascade" }),
  organisationId: text("organisation_id").references(() => organisations.id),
  actorId: text("actor_id").references(() => users.id),
  scopeJson: text("scope_json").notNull().default("{}"),
  payloadJson: text("payload_json").notNull().default("{}"),
  prevHash: text("prev_hash").notNull(),     // tip hash before this event (chain_key for genesis)
  hash: text("hash").notNull(),              // SHA-256(prev_hash + canonicalJson(content))
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
});

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  useType: text("use_type").notNull(),       // licenceType enum value | 'dub_language'
  territory: text("territory"),
  language: text("language"),
  validFrom: integer("valid_from"),
  validTo: integer("valid_to"),
  status: text("status", { enum: ["granted", "revoked", "expired"] }).notNull().default("granted"),
  grantedEventId: text("granted_event_id").notNull().references(() => complianceEvents.id),
  revokedEventId: text("revoked_event_id").references(() => complianceEvents.id),
  updatedAt: integer("updated_at").notNull(),
});

export const strikeLocks = sqliteTable("strike_locks", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["global", "organisation", "production", "licence"] }).notNull(),
  scopeId: text("scope_id"),                 // null for global; else org/production/licence id
  reason: text("reason").notNull(),
  declaredBy: text("declared_by").notNull().references(() => users.id),
  declaredAt: integer("declared_at").notNull(),
  liftedBy: text("lifted_by").references(() => users.id),
  liftedAt: integer("lifted_at"),
  status: text("status", { enum: ["active", "lifted"] }).notNull().default("active"),
});

export const replicaTransfers = sqliteTable("replica_transfers", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  fromOrganisationId: text("from_organisation_id").references(() => organisations.id),
  toPartyName: text("to_party_name").notNull(),
  toPartyDetailsJson: text("to_party_details_json").notNull().default("{}"),
  unionApproved: integer("union_approved", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["requested", "approved", "denied"] }).notNull().default("requested"),
  requestedBy: text("requested_by").notNull().references(() => users.id),
  decidedBy: text("decided_by").references(() => users.id),
  decidedAt: integer("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: integer("created_at").notNull(),
});

export const complianceAttestations = sqliteTable("compliance_attestations", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "cascade" }),
  organisationId: text("organisation_id").references(() => organisations.id),
  attestationType: text("attestation_type", {
    enum: ["biometric_isolation", "security_custody"],
  }).notNull(),
  attestedBy: text("attested_by").notNull().references(() => users.id),
  attestationText: text("attestation_text").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  eventId: text("event_id").references(() => complianceEvents.id),
  createdAt: integer("created_at").notNull(),
});

export const complianceCertificates = sqliteTable("compliance_certificates", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["licence", "talent", "production", "organisation"] }).notNull(),
  scopeId: text("scope_id").notNull(),
  regime: text("regime").notNull().default("sag_aftra"),
  r2Key: text("r2_key").notNull(),
  ledgerTipHash: text("ledger_tip_hash").notNull(),
  obligationsJson: text("obligations_json").notNull().default("[]"),
  eventCount: integer("event_count").notNull().default(0),
  generatedBy: text("generated_by").notNull().references(() => users.id),
  generatedAt: integer("generated_at").notNull(),
});

// ── Production cast onboarding ────────────────────────────────────────────────

// ── Pitch Vignettes ────────────────────────────────────────────────────────────

export const pitchVignettes = sqliteTable("pitch_vignettes", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  packageId: text("package_id").notNull().references(() => scanPackages.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  productionName: text("production_name").notNull(),
  characterDescription: text("character_description").notNull(),
  tone: text("tone").notNull().default("dramatic"),
  includeAudio: integer("include_audio", { mode: "boolean" }).notNull().default(false),
  sourceImageKeys: text("source_image_keys").notNull().default("[]"),  // JSON string[]
  generatedPrompt: text("generated_prompt"),
  higgsfield_job_id: text("higgsfield_job_id"),
  status: text("status").notNull().default("pending"),
  // pending | prompt_crafting | submitting | generating | complete | failed
  output_r2_key: text("output_r2_key"),
  output_duration_s: integer("output_duration_s"),
  error_text: text("error_text"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  deletedAt: integer("deleted_at"),
});

export const productionCast = sqliteTable("production_cast", {
  id: text("id").primaryKey(),
  productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  talentId: text("talent_id").references(() => users.id),
  inviteId: text("invite_id").references(() => invites.id),
  licenceId: text("licence_id").references(() => licences.id),
  // Public name for placeholder rows (no talentId/inviteId yet) — e.g. cast sourced
  // from public listings before an email is known. Renders as the cast row identity.
  actorName: text("actor_name"),
  tmdbId: integer("tmdb_id"),          // optional: dedupe + future TMDB enrichment
  sourceNote: text("source_note"),     // optional provenance, e.g. where the name was sourced
  characterName: text("character_name"),
  department: text("department"),
  sagMember: integer("sag_member", { mode: "boolean" }).notNull().default(false),
  // Self-declared union for the cast member: "SAG-AFTRA" | "Equity" | free text | null.
  // Kept consistent with talentProfiles.unionAffiliation; sagMember is derived from
  // this by the app (sagMember = unionAffiliation === "SAG-AFTRA") for back-compat.
  unionAffiliation: text("union_affiliation"),
  status: text("status").notNull().default("invited"),
  // placeholder | invited | linked | scan_uploaded | consented | declined
  // placeholder = recorded by name only; promoted to invited/linked once an email is attached.
  licenceTermsJson: text("licence_terms_json"), // stored until talent registers; then licence created
  // Data-controller attribution (item 11). While talentId is null the production
  // company is the GDPR data controller for this unclaimed likeness (side
  // agreement 39J). Set when a placeholder/unclaimed row is created; cleared and
  // recorded in the chain of custody when the talent claims their vault.
  dataControllerOrgId: text("data_controller_org_id").references(() => organisations.id),
  dataControllerSince: integer("data_controller_since"), // unix seconds
  addedBy: text("added_by").notNull().references(() => users.id),
  addedAt: integer("added_at").notNull(),
  linkedAt: integer("linked_at"),
  // Path C (agent-mediated): a reserved slot can be assigned to a representing
  // agent. repId = an existing rep on Image Vault; repInviteId = a pending rep
  // signup invite scoped to this slot. The rep then resolves the slot by
  // supplying their client's email.
  repId: text("rep_id").references(() => users.id),
  repInviteId: text("rep_invite_id"),
});

// Production-level default licence terms. Set once during guided onboarding (Step 4)
// and applied as the lowest-precedence fallback whenever a cast placeholder is
// resolved into a licence/invite (explicit overrides > per-row stored terms >
// these defaults). One row per production; absence means "no defaults set".
export const productionDefaultTerms = sqliteTable("production_default_terms", {
  productionId: text("production_id").primaryKey().references(() => productions.id, { onDelete: "cascade" }),
  intendedUse: text("intended_use"),
  licenceType: text("licence_type"),       // CastLicenceType | null
  territory: text("territory"),
  exclusivity: text("exclusivity"),        // non_exclusive | sole | exclusive
  permitAiTraining: integer("permit_ai_training", { mode: "boolean" }).notNull().default(false),
  useCategoriesJson: text("use_categories_json"), // JSON array of use-category ids (lib/consent/use-categories.ts)
  // Default multi-select use types (item 7) — JSON array of licenceType enum values.
  licenceTypesJson: text("licence_types_json"),
  // Default re-licence flag (item 9).
  isRelicense: integer("is_relicense", { mode: "boolean" }),
  validFrom: integer("valid_from"),        // unix seconds
  validTo: integer("valid_to"),            // unix seconds
  proposedFee: integer("proposed_fee"),    // pence
  updatedBy: text("updated_by").notNull().references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
});

// High-detail audit trail for production-included licences. One row per marking.
// `flagged` = the package/talent had prior usage through the platform when the
// inclusion was claimed (a potential abuse signal). We never block — we record
// the full prior-usage detail and surface flagged rows for admin review.
export const productionInclusionRecords = sqliteTable("production_inclusion_records", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  productionId: text("production_id").references(() => productions.id),
  packageId: text("package_id"),
  talentId: text("talent_id").notNull().references(() => users.id),
  markedBy: text("marked_by").notNull().references(() => users.id),
  markedAt: integer("marked_at").notNull(),
  reason: text("reason"),
  priorLicenceCount: integer("prior_licence_count").notNull().default(0),
  priorDownloadCount: integer("prior_download_count").notNull().default(0),
  priorUsageJson: text("prior_usage_json"), // detailed snapshot of the prior usage found
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  reviewedAt: integer("reviewed_at"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewNote: text("review_note"),
});

// Vendor organisations attached to a production (VFX, dubbing, scan service, …).
// This is the production-level "who's working on this" link; actual scan-data
// access remains per-licence via vendorAuthorisations + vendorAuditPassed.
// `pending` rows carry an email invite until the vendor signs up and their org
// is created + linked.
export const productionVendors = sqliteTable("production_vendors", {
  id: text("id").primaryKey(),
  productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  vendorOrgId: text("vendor_org_id").references(() => organisations.id), // null until a pending invite is accepted
  vendorType: text("vendor_type").notNull(), // OrgType snapshot (vfx_vendor | dubbing | scan_service | …)
  invitedEmail: text("invited_email"),
  invitedOrgName: text("invited_org_name"),
  inviteId: text("invite_id"), // the industry signup invite for a pending vendor
  status: text("status").notNull().default("active"), // active | pending | revoked
  addedBy: text("added_by").notNull().references(() => users.id),
  addedAt: integer("added_at").notNull(),
  revokedAt: integer("revoked_at"),
});

// Production team — explicit per-production access for org "member"-role users.
// Org owners/admins manage every production implicitly; this table grants
// individual colleagues either read-only (viewer) or operational (editor) access
// to a single production. See lib/productions/access.ts for how it's resolved.
export const productionMembers = sqliteTable("production_members", {
  productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["viewer", "editor"] }).notNull().default("viewer"),
  addedBy: text("added_by").references(() => users.id),
  addedAt: integer("added_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.productionId, t.userId] }),
}));

// ── Admin MCP integration ─────────────────────────────────────────────────────

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: text("id").primaryKey(), // UUID
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of raw token
  displayName: text("display_name").notNull(),
  scope: text("scope", { enum: ["read", "admin"] }).notNull().default("read"),
  createdAt: integer("created_at").notNull(),  // unix timestamp
  expiresAt: integer("expires_at").notNull(),  // unix timestamp; tokens always expire
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),            // null = active
});

export const mcpAuditLog = sqliteTable("mcp_audit_log", {
  id: text("id").primaryKey(), // UUID
  tokenId: text("token_id").notNull().references(() => mcpTokens.id),
  userId: text("user_id").notNull().references(() => users.id),
  tool: text("tool").notNull(), // tool name, or token.created / token.revoked
  paramsJson: text("params_json"), // redacted parameters (never contains TOTP codes)
  success: integer("success", { mode: "boolean" }).notNull(),
  message: text("message"),
  createdAt: integer("created_at").notNull(), // unix timestamp
});

// In-app notification centre (migration 0026; lightweight, poll-based).
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // e.g. vendor_authorised | scan_delivery | licence_status
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(), // unix timestamp
});

// Compliance-role access grants (Union / Regulator / Insurer "watchers").
// A compliance user only sees evidence for scopes granted here.
export const complianceGrants = sqliteTable("compliance_grants", {
  id: text("id").primaryKey(),
  complianceUserId: text("compliance_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subtype: text("subtype", { enum: ["union", "regulator", "insurer"] }).notNull(),
  // Which union a union-subtype grant is for (e.g. "sag_aftra" | "equity"), so a
  // SAG watcher only sees SAG and an Equity watcher only sees Equity. Null for
  // regulator/insurer grants and for legacy union grants predating attribution.
  unionId: text("union_id"),
  // "union" scope = read-only visibility into a union's affiliated entities: the
  // on-platform talent on the union's member roster and the productions those
  // talent are involved in. scope_id holds the union id (sag_aftra | equity).
  scope: text("scope", { enum: ["platform", "organisation", "production", "talent", "union"] }).notNull(),
  scopeId: text("scope_id"), // null = platform-wide; union id for scope = "union"
  grantedBy: text("granted_by").references(() => users.id),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});

// The insurance policy an insurer holds against a production (Phase 8 §3.2).
// Drives the underwriting dashboard's policy panel and the lapsed/uninsured-use
// flags. Bound to the insurer's production-scoped compliance grant.
export const insurerPolicies = sqliteTable("insurer_policies", {
  id: text("id").primaryKey(),
  grantId: text("grant_id").notNull().references(() => complianceGrants.id),
  productionId: text("production_id").notNull().references(() => productions.id),
  policyNumber: text("policy_number"),
  policyLine: text("policy_line", { enum: ["eo", "cyber", "completion_bond", "other"] }).notNull(),
  coverageLimit: integer("coverage_limit"),
  currency: text("currency").default("USD"),
  effectiveFrom: integer("effective_from"),
  effectiveTo: integer("effective_to"),
  notes: text("notes"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

// Document-acceptance artifact for the performer consent flow. licenceId/talentId
// are nullable so an unregistered production-held performer can accept via a
// tokenised public link before they have an account; the consent ledger
// (consentRecords / complianceEvents) is populated by replaying the acceptance
// once an identity + licence exist (at registration).
export const consentAcceptances = sqliteTable("consent_acceptances", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "cascade" }),
  castId: text("cast_id").references(() => productionCast.id, { onDelete: "cascade" }),
  talentId: text("talent_id").references(() => users.id, { onDelete: "set null" }),
  acceptedByEmail: text("accepted_by_email"),
  acceptedByRole: text("accepted_by_role").notNull().default("talent"), // talent | rep | guest
  usesConsentedJson: text("uses_consented_json").notNull().default("[]"), // array of useCategoryId
  documentVersion: text("document_version").notNull(),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  attestedAt: integer("attested_at").notNull(),
  replayedAt: integer("replayed_at"), // when written into the consent ledger
});

// Per-use-category disposition a registered performer (or their agent) sets once,
// so future requests auto-resolve. Resolver auto-acts only on unanimous
// all-'always' (grant) or all-'never' (refuse); anything mixed routes to a human.
export const standingInstructions = sqliteTable("standing_instructions", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  useCategoryId: text("use_category_id").notNull(),
  disposition: text("disposition", { enum: ["always", "case_by_case", "never"] }).notNull().default("case_by_case"),
  setBy: text("set_by").references(() => users.id),
  updatedAt: integer("updated_at").notNull(),
}, (t) => ({
  uniqTalentCategory: unique().on(t.talentId, t.useCategoryId),
}));

// Licence negotiation thread — one row per round of the back-and-forth over
// consent terms (scope + fee) between a production and a performer/agent.
export const licenceNegotiations = sqliteTable("licence_negotiations", {
  id: text("id").primaryKey(),
  licenceId: text("licence_id").notNull().references(() => licences.id, { onDelete: "cascade" }),
  round: integer("round").notNull(),
  party: text("party", { enum: ["producer", "talent", "rep"] }).notNull(),
  action: text("action", { enum: ["counter", "accepted", "declined"] }).notNull().default("counter"),
  proposedScopeJson: text("proposed_scope_json"), // array of useCategoryId
  proposedFee: integer("proposed_fee"), // pence; null = N/A
  comment: text("comment"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: integer("created_at").notNull(),
});

// RSL (Really Simple Licensing) public consent profile — Phase 1 of the RSL /
// Human Consent Registry integration (specs/RSL-CONSENT-REGISTRY-SPEC.md).
//
// Holds ONLY the exposure controls + minimal public-card fields. The consent
// *posture* itself is never stored here — it is derived at read time from the
// talent's standing_instructions on the AI use-categories (training §39G,
// replica §39E) via lib/rsl/posture.ts, so the two can never drift.
//
// A public surface (the /c/<slug> page + license.xml) is served only when BOTH
// publishOptIn (the talent's key) AND adminApproved (the admin master switch)
// are true and a slug exists — see lib/rsl/visibility.ts. Default-deny: both
// keys default off, posture defaults to prohibited.
export const rslProfiles = sqliteTable("rsl_profiles", {
  id: text("id").primaryKey(), // UUID
  talentId: text("talent_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  // key 1 — talent opts in to publish a public consent profile
  publishOptIn: integer("publish_opt_in", { mode: "boolean" }).notNull().default(false),
  // key 2 — admin master switch; default OFF even when publishOptIn is true
  adminApproved: integer("admin_approved", { mode: "boolean" }).notNull().default(false),
  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: integer("approved_at"), // unix seconds
  // Unlisted, unguessable public address (NOT the enumerable AH-/LC- codes).
  publicSlug: text("public_slug").unique(),
  // Minimal talent-curated public-card fields. NEVER any biometric/scan data.
  displayName: text("display_name"),
  profession: text("profession"),
  linksJson: text("links_json"), // JSON array of { label, url }
  // Phase 2/3 — reserved (license server + Human Consent Registry federation).
  licenseServerEnabled: integer("license_server_enabled", { mode: "boolean" }).notNull().default(false),
  humanConsentId: text("human_consent_id"),
  registryStatus: text("registry_status", { enum: ["not_linked", "pending", "linked", "error"] }).notNull().default("not_linked"),
  createdAt: integer("created_at").notNull(), // unix seconds
  updatedAt: integer("updated_at").notNull(), // unix seconds
});

// RSL Open License Protocol (OLP) request — Phase 2 of the RSL integration
// (specs/RSL-CONSENT-REGISTRY-SPEC.md). One row per machine-initiated request to
// license a talent's likeness for an AI usage, captured by the OLP token
// endpoint and resolved through the talent's consent posture:
//   red   → rejected before insert (access_denied)
//   green → auto-granted (standing instruction = always); token minted at once
//   amber → pending_review; routed to the talent/agent, granted on approval
// The license token attests CONSENT for the usage; metered billing still runs
// through royalty_sources / usage_events (wired to a formal licence separately).
export const rslLicenseRequests = sqliteTable("rsl_license_requests", {
  id: text("id").primaryKey(), // UUID — also the public request_id the client polls
  talentId: text("talent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  usage: text("usage").notNull(), // RSL usage token: ai-train | ai-use
  useCategoryId: text("use_category_id").notNull(), // mapped category: training | replica
  postureLight: text("posture_light").notNull(), // amber | green at request time
  // Requesting machine client — self-declared, UNTRUSTED.
  clientId: text("client_id"),
  clientName: text("client_name"),
  contactEmail: text("contact_email"),
  intendedUse: text("intended_use"),
  status: text("status", {
    enum: ["pending_review", "granted", "denied", "expired"],
  }).notNull().default("pending_review"),
  decidedBy: text("decided_by").references(() => users.id),
  decidedAt: integer("decided_at"), // unix seconds
  // License credential, issued on grant. SHA-256 of the raw `rsl_` token.
  licenseTokenHash: text("license_token_hash").unique(),
  licenseExpiresAt: integer("license_expires_at"), // unix seconds
  // Link to a formal licence once one is created through the normal flow.
  licenceId: text("licence_id").references(() => licences.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(), // unix seconds
  updatedAt: integer("updated_at").notNull(), // unix seconds
});

export const emailLog = sqliteTable("email_log", {
  id: text("id").primaryKey(), // UUID
  toAddress: text("to_address").notNull(), // comma-separated if multiple recipients
  subject: text("subject").notNull(),
  status: text("status", { enum: ["sent", "failed"] }).notNull(),
  errorCode: integer("error_code"), // HTTP status from Resend; null on success
  errorBody: text("error_body"), // Resend error response body or fetch exception message
  sentAt: integer("sent_at").notNull(), // unix seconds
});
