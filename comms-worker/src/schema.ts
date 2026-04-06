/**
 * Slim schema for the comms worker.
 * Only the tables needed for inbound email processing.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("talent"),
  inboundEnabled: integer("inbound_enabled", { mode: "boolean" }).notNull().default(false),
});

export const inboundAliases = sqliteTable("inbound_aliases", {
  id: text("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  aliasType: text("alias_type").notNull().default("user"),
  ownerUserId: text("owner_user_id").notNull(),
  ownerEntityId: text("owner_entity_id"),
  status: text("status").notNull().default("active"),
  lastUsedAt: integer("last_used_at"),
});

export const receivedEmails = sqliteTable("received_emails", {
  id: text("id").primaryKey(),
  resendEmailId: text("resend_email_id").unique(),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  references: text("references"),
  aliasId: text("alias_id"),
  ownerUserId: text("owner_user_id").notNull(),
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
  processingStatus: text("processing_status").notNull().default("pending"),
  routingStatus: text("routing_status").notNull().default("matched"),
  dedupeKey: text("dedupe_key"),
  threadKey: text("thread_key"),
  createdAt: integer("created_at").notNull(),
});

export const receivedEmailRecipients = sqliteTable("received_email_recipients", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull(),
  type: text("type").notNull(),
  displayName: text("display_name"),
  address: text("address").notNull(),
});

export const receivedEmailAttachments = sqliteTable("received_email_attachments", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull(),
  filename: text("filename"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  storageKey: text("storage_key"),
  checksum: text("checksum"),
  scanStatus: text("scan_status").notNull().default("pending"),
  textExtractionStatus: text("text_extraction_status").notNull().default("pending"),
  extractedText: text("extracted_text"),
  createdAt: integer("created_at").notNull(),
});

export const aiTriageResults = sqliteTable("ai_triage_results", {
  id: text("id").primaryKey(),
  emailId: text("email_id").notNull(),
  modelName: text("model_name").notNull(),
  promptVersion: text("prompt_version").notNull().default("v1"),
  summary: text("summary"),
  category: text("category"),
  urgency: text("urgency"),
  confidence: real("confidence"),
  structuredDataJson: text("structured_data_json"),
  recommendedAction: text("recommended_action"),
  riskFlagsJson: text("risk_flags_json"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
});

export const emailThreadLinks = sqliteTable("email_thread_links", {
  id: text("id").primaryKey(),
  ownerEntityId: text("owner_entity_id"),
  threadKey: text("thread_key").notNull().unique(),
  latestEmailId: text("latest_email_id"),
  emailCount: integer("email_count").notNull().default(1),
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
