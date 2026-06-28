/**
 * RSL consent posture — derived, never stored.
 *
 * The single source of truth for a talent's AI-consent stance is their
 * `standing_instructions` (per use-category disposition). This module projects
 * those onto the Human Consent Registry stoplight (red / amber / green) and the
 * RSL usage vocabulary, so the public posture can never drift from what the
 * talent actually set.
 *
 * Default-deny: a category with no instruction on file is treated as PROHIBITED
 * (red) for the purposes of public exposure — deliberately more conservative
 * than the internal resolver (lib/consent/resolve.ts), which treats a missing
 * instruction as case_by_case. Public means cautious.
 *
 * See specs/RSL-CONSENT-REGISTRY-SPEC.md.
 */

import { eq } from "drizzle-orm";
import { standingInstructions } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";
import type { Disposition } from "@/lib/consent/resolve";

type Db = ReturnType<typeof getDb>;

export type Light = "red" | "amber" | "green";

/**
 * Map a stored disposition onto the stoplight. `null`/undefined (no instruction
 * on file) → red, matching the prohibited-by-default rule.
 */
export function dispositionToLight(d: Disposition | null | undefined): Light {
  switch (d) {
    case "always":
      return "green";
    case "case_by_case":
      return "amber";
    default:
      return "red"; // "never" | null | undefined
  }
}

/**
 * RSL usage token per use-category. Only the two AI/biometric categories emit a
 * standalone RSL <permits>/<prohibits> term today (Q2 in the spec); the rest are
 * carried as stubs (null) — surfaced as human-readable detail rows but not as
 * RSL terms. Adding one later is a one-line change here.
 */
export const RSL_USAGE_MAP: Record<string, string | null> = {
  training: "ai-train", // §39G — live
  replica: "ai-use", // §39E — live
  dub: null, // §39D — stub
  "vfx-this": null, // stub
  reuse: null, // stub
  marketing: null, // stub
};

/** RSL <payment type> to use for a permitted-with-terms (amber) usage. */
export const RSL_PAYMENT_TYPE: Record<string, string> = {
  "ai-train": "training",
  "ai-use": "inference",
};

/** Category ids that drive the headline posture (those with a live RSL token). */
export const POSTURE_CATEGORY_IDS = Object.keys(RSL_USAGE_MAP).filter(
  (id) => RSL_USAGE_MAP[id] !== null,
);

export interface CategoryPosture {
  id: string;
  name: string;
  description: string;
  regimeTag: string | null;
  sensitive: boolean;
  /** null = no instruction on file (treated as red). */
  disposition: Disposition | null;
  light: Light;
  /** RSL usage token, or null for stub categories. */
  rslUsage: string | null;
}

export interface Posture {
  /** Every category, in canonical taxonomy order. */
  categories: CategoryPosture[];
  /** Headline light across the live (rslUsage !== null) categories. */
  overall: Light;
}

/**
 * Headline light:
 *   - all live categories green → green
 *   - all live categories red   → red
 *   - anything mixed/amber      → amber ("permitted with terms")
 * This is an honest summary rather than a strict worst-case, so a talent who
 * permits one use but not another reads as amber, not red.
 */
function overallLight(lights: Light[]): Light {
  if (lights.length === 0) return "red";
  if (lights.every((l) => l === "green")) return "green";
  if (lights.every((l) => l === "red")) return "red";
  return "amber";
}

/** Build a posture from an already-loaded { useCategoryId: disposition } map. */
export function postureFromMap(map: Record<string, Disposition>): Posture {
  const categories: CategoryPosture[] = USE_CATEGORIES.map((c) => {
    const disposition = (map[c.id] ?? null) as Disposition | null;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      regimeTag: c.regimeTag,
      sensitive: c.sensitive,
      disposition,
      light: dispositionToLight(disposition),
      rslUsage: RSL_USAGE_MAP[c.id] ?? null,
    };
  });
  const liveLights = categories.filter((c) => c.rslUsage !== null).map((c) => c.light);
  return { categories, overall: overallLight(liveLights) };
}

/** Derive a talent's consent posture from their standing instructions. */
export async function derivePosture(db: Db, talentId: string): Promise<Posture> {
  const rows = await db
    .select({
      useCategoryId: standingInstructions.useCategoryId,
      disposition: standingInstructions.disposition,
    })
    .from(standingInstructions)
    .where(eq(standingInstructions.talentId, talentId))
    .all();
  const map: Record<string, Disposition> = {};
  for (const r of rows) map[r.useCategoryId] = r.disposition as Disposition;
  return postureFromMap(map);
}
