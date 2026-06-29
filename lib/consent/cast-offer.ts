/**
 * The "current offer" for a production-held cast row during rep pre-negotiation.
 *
 * For a licence, the standing offer is the licence's own fields. For a
 * placeholder cast row there is no licence yet — the offer is the §39 scope + fee
 * carried in production_cast.licence_terms_json (falling back to the production's
 * default terms for scope). A producer counter revises that stored offer so the
 * document the performer is eventually sent reflects the agreed scope.
 */

import { productionCast } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { reconcileTrainingFlag, type UseCategoryId } from "./use-categories";
import { loadProductionDefaultTerms, type CastLicenceTerms } from "@/lib/productions/cast";
import { parseUseCategoryIds } from "./use-categories";

type Db = ReturnType<typeof getDb>;

export interface CastOffer {
  scope: UseCategoryId[];
  fee: number | null;
}

function parseTerms(json: string | null): CastLicenceTerms {
  if (!json) return {};
  try { return JSON.parse(json) as CastLicenceTerms; } catch { return {}; }
}

/** The production's standing offer to this cast row (scope + fee). */
export async function getCastOffer(db: Db, castId: string, productionId: string): Promise<CastOffer> {
  const cast = await db
    .select({ licenceTermsJson: productionCast.licenceTermsJson })
    .from(productionCast)
    .where(eq(productionCast.id, castId))
    .get();
  const terms = parseTerms(cast?.licenceTermsJson ?? null);
  let scope = parseUseCategoryIds(JSON.stringify(terms.useCategoryIds ?? []));
  if (scope.length === 0) {
    const defaults = await loadProductionDefaultTerms(db, productionId);
    if (defaults.useCategoryIds?.length) scope = defaults.useCategoryIds;
  }
  return { scope, fee: terms.proposedFee ?? null };
}

/**
 * Revise the production's standing offer on a cast row (producer counter, or
 * applying an accepted rep counter). Preserves all other stored term fields and
 * reconciles the AI-training flag with the new scope.
 */
export async function applyCastOfferScope(
  db: Db,
  castId: string,
  scope: string[],
  fee?: number | null,
): Promise<void> {
  const cast = await db
    .select({ licenceTermsJson: productionCast.licenceTermsJson })
    .from(productionCast)
    .where(eq(productionCast.id, castId))
    .get();
  const terms = parseTerms(cast?.licenceTermsJson ?? null);
  const reconciled = reconcileTrainingFlag({ useCategoryIds: scope, permitAiTraining: false });
  const next: CastLicenceTerms = {
    ...terms,
    useCategoryIds: reconciled.useCategoryIds,
    permitAiTraining: reconciled.permitAiTraining,
    ...(fee !== undefined ? { proposedFee: fee } : {}),
  };
  await db.update(productionCast).set({ licenceTermsJson: JSON.stringify(next) }).where(eq(productionCast.id, castId));
}
