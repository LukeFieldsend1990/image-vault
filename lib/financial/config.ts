/**
 * Upfront fee model (provisional, under test).
 *
 * Two streams, two payers:
 *  - Talent tier fee — billed per talent when an agent assigns their tier.
 *  - Production access fee — billed per production by Pact/Bectu budget band.
 *
 * This is separate from the royalty/usage split (talentSettings + usageEvents),
 * which governs ongoing per-use revenue. Amounts are in minor units (cents) and
 * are PLACEHOLDERS pending commercial sign-off — they live here so the matrix is
 * a single source of truth. Relicensing rev-share (10%) is deferred.
 */

export const CURRENCY = "usd" as const;

export type TalentTier = "emerging" | "established" | "a_list" | "bespoke";

export interface TierDef {
  id: TalentTier;
  label: string;
  amountCents: number | null; // null = bespoke / negotiated
}

export const TALENT_TIERS: TierDef[] = [
  { id: "emerging", label: "Emerging", amountCents: 100_000 },
  { id: "established", label: "Established", amountCents: 500_000 },
  { id: "a_list", label: "A-List", amountCents: 800_000 },
  { id: "bespoke", label: "Bespoke Elite", amountCents: null },
];

export type ProductionBand = "band_1" | "band_2" | "band_3" | "band_4" | "bespoke";

export interface BandDef {
  id: ProductionBand;
  label: string;
  amountCents: number | null;
}

// Bands track the Pact/Bectu budget per episodic hour (Band 4 = >£7m/hr, top bracket).
export const PRODUCTION_BANDS: BandDef[] = [
  { id: "band_1", label: "Band 1", amountCents: 250_000 },
  { id: "band_2", label: "Band 2", amountCents: 500_000 },
  { id: "band_3", label: "Band 3", amountCents: 1_000_000 },
  { id: "band_4", label: "Band 4 (>£7m/hr)", amountCents: 2_000_000 },
  { id: "bespoke", label: "Bespoke", amountCents: null },
];

/** Default window before a pending fee is chased; admin can override per obligation. */
export const DEFAULT_GRACE_DAYS = 30;

export type FeeObligationType = "talent_tier" | "production_access";
export type FeeStatus = "pending" | "paid" | "waived" | "cancelled";

export function tierDef(id: string | null | undefined): TierDef | undefined {
  return TALENT_TIERS.find((t) => t.id === id);
}
export function bandDef(id: string | null | undefined): BandDef | undefined {
  return PRODUCTION_BANDS.find((b) => b.id === id);
}

export function isTalentTier(v: unknown): v is TalentTier {
  return typeof v === "string" && TALENT_TIERS.some((t) => t.id === v);
}
export function isProductionBand(v: unknown): v is ProductionBand {
  return typeof v === "string" && PRODUCTION_BANDS.some((b) => b.id === v);
}

export function formatCents(amountCents: number | null, currency: string = CURRENCY): string {
  if (amountCents == null) return "Bespoke";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amountCents / 100);
}
