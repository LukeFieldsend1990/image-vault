// Minimal schema subset for the higgs-worker (avoids importing the full Next.js schema)
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const pitchVignettes = sqliteTable("pitch_vignettes", {
  id: text("id").primaryKey(),
  talentId: text("talent_id").notNull(),
  packageId: text("package_id").notNull(),
  createdBy: text("created_by").notNull(),
  productionName: text("production_name").notNull(),
  characterDescription: text("character_description").notNull(),
  tone: text("tone").notNull(),
  includeAudio: integer("include_audio", { mode: "boolean" }).notNull().default(false),
  sourceImageKeys: text("source_image_keys").notNull().default("[]"),
  generatedPrompt: text("generated_prompt"),
  higgsfield_job_id: text("higgsfield_job_id"),
  status: text("status").notNull().default("pending"),
  output_r2_key: text("output_r2_key"),
  output_duration_s: integer("output_duration_s"),
  error_text: text("error_text"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  deletedAt: integer("deleted_at"),
});

export const talentProfiles = sqliteTable("talent_profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull(),
  knownFor: text("known_for").notNull().default("[]"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
});
