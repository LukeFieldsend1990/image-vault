/**
 * MCP-pattern skill system types.
 * Each skill is a self-describing tool with typed parameters and an execute handler.
 */

import type { SessionPayload } from "@/lib/auth/jwt";
import type { drizzle } from "drizzle-orm/d1";

type Db = ReturnType<typeof drizzle>;

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  description: string;
  required: boolean;
  default?: unknown;
  /** For "select" type: the allowed values */
  options?: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** Which triage categories this skill is relevant to */
  categories: string[];
  parameters: SkillParameter[];
  execute: (ctx: SkillContext, params: Record<string, unknown>) => Promise<SkillResult>;
}

export interface SkillContext {
  session: SessionPayload;
  db: Db;
  env: Record<string, unknown>;
  emailId: string;
}

export interface SkillResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface SkillSuggestion {
  skillId: string;
  displayName: string;
  description: string;
  /** Pre-filled parameter values from triage structured data */
  prefilled: Record<string, unknown>;
  /** Confidence inherited from the triage result */
  confidence: number;
}
