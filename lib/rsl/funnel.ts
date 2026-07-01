/**
 * OLP → Image Vault licence funnel. Turns an amber/green OLP request into a real
 * `licences` row and, on approval, a metered `royaltySources` credential —
 * reusing the same fee (15% platform) + royalty machinery as the human flow.
 * Packageless (likeness-rights) so it can't reuse /api/licences/[id]/approve
 * (which requires a package); the approval logic lives here instead.
 */
import { eq } from "drizzle-orm";
import { licences, royaltySources } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { mintLicenceCode } from "@/lib/codes/codes";
import { sha256Hex, generateRoyaltyKey } from "@/lib/auth/requireRoyaltySource";
import type { RateCard } from "./rateCard";

type Db = ReturnType<typeof getDb>;

const LICENCE_TYPE_FOR_USAGE: Record<string, "training_data" | "ai_avatar"> = {
  "ai-train": "training_data",
  "ai-use": "ai_avatar",
};

export interface Offer {
  usage: string;
  unit_type: string | null;
  unit_rate_cents: number | null;
  upfront_fee_cents: number | null;
  currency: string;
  term_days: number | null;
  priced: boolean; // a rate card set the terms
}

export function buildOffer(usage: string, rc: RateCard | undefined): Offer {
  return {
    usage,
    unit_type: rc?.unitType ?? null,
    unit_rate_cents: rc?.unitRatePence ?? null,
    upfront_fee_cents: rc?.upfrontFeePence ?? null,
    currency: rc?.currency ?? "USD",
    term_days: rc?.termDays ?? null,
    priced: !!rc,
  };
}

/** Create the PENDING likeness licence for an OLP request. */
export async function createOlpLicence(
  db: Db,
  opts: {
    talentId: string;
    usage: string;
    categoryId: string;
    licenseeId: string;
    organisationId: string | null;
    clientName?: string | null;
    intendedUse?: string | null;
    rateCard?: RateCard;
  },
): Promise<{ licenceId: string }> {
  const now = Math.floor(Date.now() / 1000);
  const termDays = opts.rateCard?.termDays ?? 365;
  const id = crypto.randomUUID();
  const licenceType = LICENCE_TYPE_FOR_USAGE[opts.usage] ?? "ai_avatar";
  await db.insert(licences).values({
    id,
    talentId: opts.talentId,
    licenseeId: opts.licenseeId,
    projectName: (opts.clientName || "AI licence").slice(0, 200),
    productionCompany: (opts.clientName || "AI client").slice(0, 200),
    intendedUse: (opts.intendedUse || `AI ${opts.usage}`).slice(0, 500),
    validFrom: now,
    validTo: now + termDays * 86400,
    status: "PENDING",
    licenceType,
    useCategoriesJson: JSON.stringify([opts.categoryId]),
    permitAiTraining: opts.categoryId === "training",
    deliveryMode: "metered_api",
    organisationId: opts.organisationId ?? null,
    exclusivity: "non_exclusive",
    proposedUnitType: opts.rateCard?.unitType ?? null,
    proposedUnitRatePence: opts.rateCard?.unitRatePence ?? null,
    proposedFee: opts.rateCard?.upfrontFeePence ?? null,
    source: "olp",
    createdAt: now,
  });
  try {
    await mintLicenceCode(db, id);
  } catch {
    /* non-fatal */
  }
  return { licenceId: id };
}

/**
 * Approve an OLP licence: set agreed fee (15% platform) + unit rate, and mint a
 * metered royalty source (`rsk_` key). Returns the raw key once (null if the
 * licence carries no unit rate). `approverId` is the human approver, or the
 * talent themselves for the auto-accept path.
 */
export async function approveOlpLicence(
  db: Db,
  opts: {
    licenceId: string;
    approverId: string;
    clientId?: string | null;
    usageCapUnits?: number | null;
    agreedUnitRatePence?: number | null; // human override
  },
): Promise<{ royaltyKey: string | null }> {
  const lic = await db
    .select({
      id: licences.id,
      status: licences.status,
      projectName: licences.projectName,
      organisationId: licences.organisationId,
      proposedFee: licences.proposedFee,
      proposedUnitType: licences.proposedUnitType,
      proposedUnitRatePence: licences.proposedUnitRatePence,
    })
    .from(licences)
    .where(eq(licences.id, opts.licenceId))
    .get();
  if (!lic || lic.status !== "PENDING") return { royaltyKey: null };

  const now = Math.floor(Date.now() / 1000);
  const agreedFee = lic.proposedFee ?? null;
  const platformFee = agreedFee !== null ? Math.round(agreedFee * 0.15) : null;
  const agreedUnitType = lic.proposedUnitType ?? null;
  const agreedUnitRatePence =
    typeof opts.agreedUnitRatePence === "number" && opts.agreedUnitRatePence > 0
      ? Math.floor(opts.agreedUnitRatePence)
      : lic.proposedUnitRatePence ?? null;

  await db
    .update(licences)
    .set({ status: "APPROVED", approvedBy: opts.approverId, approvedAt: now, agreedFee, platformFee, agreedUnitType, agreedUnitRatePence })
    .where(eq(licences.id, opts.licenceId));

  let royaltyKey: string | null = null;
  if (agreedUnitType && agreedUnitRatePence) {
    try {
      const rawKey = generateRoyaltyKey();
      const apiKeyHash = await sha256Hex(rawKey);
      await db.insert(royaltySources).values({
        id: crypto.randomUUID(),
        licenceId: opts.licenceId,
        organisationId: lic.organisationId ?? null,
        displayName: lic.projectName,
        apiKeyHash,
        unitType: agreedUnitType as "per_generation" | "per_1k_inferences" | "per_frame" | "per_second",
        unitRatePence: agreedUnitRatePence,
        status: "active",
        createdAt: now,
        createdBy: opts.approverId,
        origin: "olp",
        clientId: opts.clientId ?? null,
        usageCapUnits: opts.usageCapUnits ?? null,
      });
      royaltyKey = rawKey;
    } catch {
      /* non-fatal */
    }
  }
  return { royaltyKey };
}
