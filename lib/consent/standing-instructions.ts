/**
 * Standing-instruction persistence helpers.
 *
 * A performer (or their agent) sets one disposition per use category. We store
 * only the rows that exist; any category without a row is treated as
 * 'case_by_case' by the resolver (lib/consent/resolve.ts).
 */

import { standingInstructions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import type { Disposition, StandingInstructionMap } from "./resolve";
import { isUseCategoryId } from "./use-categories";

type Db = ReturnType<typeof getDb>;

const DISPOSITIONS: readonly Disposition[] = ["always", "case_by_case", "never"];
export function isDisposition(v: unknown): v is Disposition {
  return typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);
}

/** Load a talent's standing instructions as a { useCategoryId: disposition } map. */
export async function loadStandingInstructions(db: Db, talentId: string): Promise<StandingInstructionMap> {
  const rows = await db
    .select({ useCategoryId: standingInstructions.useCategoryId, disposition: standingInstructions.disposition })
    .from(standingInstructions)
    .where(eq(standingInstructions.talentId, talentId))
    .all();
  const map: StandingInstructionMap = {};
  for (const r of rows) map[r.useCategoryId] = r.disposition as Disposition;
  return map;
}

/** True if the talent has set at least one standing instruction (i.e. is configured). */
export async function hasStandingInstructions(db: Db, talentId: string): Promise<boolean> {
  const row = await db
    .select({ id: standingInstructions.id })
    .from(standingInstructions)
    .where(eq(standingInstructions.talentId, talentId))
    .get();
  return Boolean(row);
}

/**
 * Upsert a set of dispositions for a talent. Only valid category ids and
 * dispositions are written. `setBy` records who made the change (talent or agent).
 */
export async function setStandingInstructions(
  db: Db,
  talentId: string,
  setBy: string,
  updates: Record<string, string>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ id: standingInstructions.id, useCategoryId: standingInstructions.useCategoryId })
    .from(standingInstructions)
    .where(eq(standingInstructions.talentId, talentId))
    .all();
  const byCategory = new Map(existing.map((r) => [r.useCategoryId, r.id]));

  for (const [categoryId, disposition] of Object.entries(updates)) {
    if (!isUseCategoryId(categoryId) || !isDisposition(disposition)) continue;
    const id = byCategory.get(categoryId);
    if (id) {
      await db
        .update(standingInstructions)
        .set({ disposition, setBy, updatedAt: now })
        .where(eq(standingInstructions.id, id));
    } else {
      await db.insert(standingInstructions).values({
        id: crypto.randomUUID(),
        talentId,
        useCategoryId: categoryId,
        disposition,
        setBy,
        updatedAt: now,
      });
    }
  }
}
