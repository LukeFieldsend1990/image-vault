/**
 * Organisation subtypes.
 *
 * `org_type` is a decoration on an `industry`-role organisation — it doesn't
 * change permissions, it drives which UI/workflows are surfaced and which code
 * prefix the org maps to in the chain of custody (VX = vfx_vendor, CC =
 * scan_service, DB = dubbing, PR = production_company/studio, …).
 *
 * Single source of truth: the Drizzle enum on `organisations.org_type`
 * (lib/db/schema.ts) is built from ORG_TYPES, and all UI/validation reads from
 * here so the set can never drift.
 */

export const ORG_TYPES = [
  "production_company",
  "studio",
  "vfx_vendor",
  "dubbing", // dubbing / localisation house (DB code) — voice & language reuse, 39.D scope
  "advertising_agency",
  "brand",
  "publisher",
  "game_studio",
  "ai_company",
  "broadcaster",
  "scan_service",
  "other",
] as const;

export type OrgType = (typeof ORG_TYPES)[number];

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  production_company: "Production Company",
  studio: "Studio",
  vfx_vendor: "VFX Vendor",
  dubbing: "Dubbing / Localisation",
  advertising_agency: "Advertising Agency",
  brand: "Brand",
  publisher: "Publisher",
  game_studio: "Game Studio",
  ai_company: "AI Company",
  broadcaster: "Broadcaster",
  scan_service: "Scan Service",
  other: "Other",
};

export const ORG_TYPE_SHORT_LABELS: Record<OrgType, string> = {
  production_company: "Prod Co",
  studio: "Studio",
  vfx_vendor: "VFX",
  dubbing: "Dubbing",
  advertising_agency: "Ad Agency",
  brand: "Brand",
  publisher: "Publisher",
  game_studio: "Games",
  ai_company: "AI",
  broadcaster: "Broadcast",
  scan_service: "Scan",
  other: "Other",
};

export function isOrgType(v: unknown): v is OrgType {
  return typeof v === "string" && (ORG_TYPES as readonly string[]).includes(v);
}

/**
 * Org types that handle likeness data ("movers") and are therefore subject to
 * the environment-audit gate before Bridge access can be provisioned.
 */
export const VENDOR_ORG_TYPES: readonly OrgType[] = ["vfx_vendor", "dubbing", "scan_service"];

export function isVendorOrgType(v: OrgType | string): boolean {
  return (VENDOR_ORG_TYPES as readonly string[]).includes(v);
}
