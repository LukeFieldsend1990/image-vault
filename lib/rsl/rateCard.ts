/**
 * Talent AI rate card — a standing per-usage price list. When present, an OLP
 * request can be quoted instantly; with auto_accept + posture green it
 * auto-licenses. Amounts are integer cents (USD).
 */
import { and, eq } from "drizzle-orm";
import { rslRateCards } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { USAGE_TO_CATEGORY } from "./olp";

type Db = ReturnType<typeof getDb>;
export type RateCard = typeof rslRateCards.$inferSelect;

export const RATE_CARD_CATEGORIES = ["training", "replica"] as const;
export const UNIT_TYPES = ["per_generation", "per_1k_inferences", "per_frame", "per_second"] as const;

export async function listRateCards(db: Db, talentId: string): Promise<RateCard[]> {
  return db.select().from(rslRateCards).where(eq(rslRateCards.talentId, talentId)).all();
}

export async function getRateCard(db: Db, talentId: string, useCategoryId: string): Promise<RateCard | undefined> {
  return db
    .select()
    .from(rslRateCards)
    .where(and(eq(rslRateCards.talentId, talentId), eq(rslRateCards.useCategoryId, useCategoryId)))
    .get();
}

/** The active rate card that prices a given RSL usage, if any. */
export async function getRateCardForUsage(db: Db, talentId: string, usage: string): Promise<RateCard | undefined> {
  const cat = USAGE_TO_CATEGORY[usage];
  if (!cat) return undefined;
  const rc = await getRateCard(db, talentId, cat);
  return rc && rc.active ? rc : undefined;
}

export interface RateCardInput {
  unitType: string;
  unitRatePence: number;
  upfrontFeePence?: number | null;
  termDays?: number;
  autoAccept?: boolean;
  active?: boolean;
}

export async function upsertRateCard(
  db: Db,
  talentId: string,
  useCategoryId: string,
  input: RateCardInput,
): Promise<RateCard> {
  const now = Math.floor(Date.now() / 1000);
  const unitType = (UNIT_TYPES as readonly string[]).includes(input.unitType) ? input.unitType : "per_generation";
  const unitRatePence = Math.max(0, Math.floor(input.unitRatePence));
  const upfrontFeePence =
    input.upfrontFeePence == null ? null : Math.max(0, Math.floor(input.upfrontFeePence));
  const termDays = input.termDays && input.termDays > 0 ? Math.floor(input.termDays) : 365;
  const existing = await getRateCard(db, talentId, useCategoryId);
  if (existing) {
    await db
      .update(rslRateCards)
      .set({
        unitType: unitType as RateCard["unitType"],
        unitRatePence,
        upfrontFeePence,
        termDays,
        autoAccept: input.autoAccept ?? existing.autoAccept,
        active: input.active ?? existing.active,
        updatedAt: now,
      })
      .where(eq(rslRateCards.id, existing.id));
    return (await getRateCard(db, talentId, useCategoryId))!;
  }
  await db.insert(rslRateCards).values({
    id: crypto.randomUUID(),
    talentId,
    useCategoryId,
    unitType: unitType as RateCard["unitType"],
    unitRatePence,
    upfrontFeePence,
    termDays,
    autoAccept: input.autoAccept ?? false,
    active: input.active ?? true,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
  });
  return (await getRateCard(db, talentId, useCategoryId))!;
}

export async function deleteRateCard(db: Db, talentId: string, useCategoryId: string): Promise<void> {
  await db
    .delete(rslRateCards)
    .where(and(eq(rslRateCards.talentId, talentId), eq(rslRateCards.useCategoryId, useCategoryId)));
}
