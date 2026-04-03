/**
 * Drizzle ORM schema for the AI cron worker.
 * Subset of the main app schema — only tables needed for signal gathering + suggestion writing.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["talent", "rep", "licensee", "admin"] }).notNull().default("talent"),
  suspendedAt: integer("suspended_at"),
  phone: text("phone"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const talentReps = sqliteTable("talent_reps", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  repId: text("rep_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const talentProfiles = sqliteTable("talent_profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull(),
  popularity: real("popularity"),
});

export const scanPackages = sqliteTable("scan_packages", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["uploading", "ready", "error"] }).notNull().default("uploading"),
  totalSizeBytes: integer("total_size_bytes"),
  createdAt: integer("created_at").notNull(),
});

export const scanFiles = sqliteTable("scan_files", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadStatus: text("upload_status", { enum: ["pending", "uploading", "complete", "error"] }).notNull().default("pending"),
});

export const licences = sqliteTable("licences", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  packageId: text("package_id").notNull(),
  licenseeId: text("licensee_id").notNull(),
  projectName: text("project_name").notNull(),
  productionCompany: text("production_company").notNull(),
  licenceType: text("licence_type"),
  territory: text("territory"),
  exclusivity: text("exclusivity"),
  proposedFee: integer("proposed_fee"),
  agreedFee: integer("agreed_fee"),
  downloadCount: integer("download_count").notNull().default(0),
  validTo: integer("valid_to").notNull(),
  status: text("status", { enum: ["PENDING", "APPROVED", "DENIED", "REVOKED", "EXPIRED"] }).notNull().default("PENDING"),
  createdAt: integer("created_at").notNull(),
});

export const suggestions = sqliteTable("suggestions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  feature: text("feature").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  priority: integer("priority").notNull().default(50),
  acknowledgedAt: integer("acknowledged_at"),
  clickedAt: integer("clicked_at"),
  expiresAt: integer("expires_at").notNull(),
  batchId: text("batch_id"),
  createdAt: integer("created_at").notNull(),
});

export const aiSettings = sqliteTable("ai_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at").notNull(),
});

export const aiCostLog = sqliteTable("ai_cost_log", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
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
