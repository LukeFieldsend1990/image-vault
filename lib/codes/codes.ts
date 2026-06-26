import { users, organisations, productions, scanPackages, licences } from "@/lib/db/schema";
import { and, eq, sql, isNotNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

// Accepts both the schema-typed db from getDb() and the generically-typed db
// carried by skill/MCP contexts — these helpers only use plain select/update.
type Db = ReturnType<typeof drizzle>;

/**
 * System-generated pretty-print codes. Decorators only — never licensing keys.
 * Format: PREFIX-NNNN, zero-padded to a minimum of 4 digits, no upper cap
 * (247 -> "0247", 12476 -> "12476"). Minted at creation; backfilled in 0060.
 */

export function formatCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/**
 * Normalise a free-text query that looks like a system code (AH-0247, ag-3,
 * "VX 12", lc-0001) into its canonical PREFIX-NNNN form, or null if it isn't
 * code-shaped. Lets lookup/selection surfaces (actor, vendor, rep pickers)
 * resolve an entity by its printed code regardless of case, spacing, hyphen, or
 * un-padded digits. Decorative codes are zero-padded to a minimum of 4 digits to
 * match how they're stored; a wider number (e.g. 12476) is left as-is.
 */
export function canonicalCode(q: string | null | undefined): string | null {
  if (!q) return null;
  const cleaned = q.trim().toUpperCase().replace(/\s+/g, "");
  const m = cleaned.match(/^([A-Z]{2,3})-?0*(\d+)$/);
  if (!m) return null;
  const [, prefix, digits] = m;
  return `${prefix}-${digits.padStart(4, "0")}`;
}

/** Org subtype → code prefix. */
export function orgPrefix(orgType: string | null | undefined): "VX" | "CC" | "DB" | "AGY" | "OG" {
  if (orgType === "vfx_vendor") return "VX";
  if (orgType === "scan_service") return "CC";
  if (orgType === "dubbing") return "DB";
  if (orgType === "agency") return "AGY"; // talent agency org (distinct from per-agent AG codes)
  return "OG";
}

/** Mint the next AH/AG code for a user of the given role (no-op for other roles). */
export async function mintUserCode(db: Db, userId: string, role: string): Promise<void> {
  const prefix = role === "talent" ? "AH" : role === "rep" ? "AG" : null;
  if (!prefix) return;
  try {
    const row = await db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, role as "talent" | "rep"))
      .get();
    await db.update(users).set({ shortCode: formatCode(prefix, (row?.n ?? 0)) }).where(eq(users.id, userId));
  } catch { /* decorator — best effort */ }
}

/** Mint the next code for an organisation, prefixed by its subtype. */
export async function mintOrgCode(db: Db, orgId: string, orgType: string): Promise<void> {
  const prefix = orgPrefix(orgType);
  try {
    // Count orgs already carrying this prefix (the new row has no code yet) + 1.
    const c = await db
      .select({ n: sql<number>`count(*)` })
      .from(organisations)
      .where(and(isNotNull(organisations.shortCode), sql`${organisations.shortCode} LIKE ${prefix + "-%"}`))
      .get();
    await db.update(organisations).set({ shortCode: formatCode(prefix, (c?.n ?? 0) + 1) }).where(eq(organisations.id, orgId));
  } catch { /* best effort */ }
}

/** Mint the next PR code for a production. */
export async function mintProductionCode(db: Db, productionId: string): Promise<void> {
  try {
    const row = await db.select({ n: sql<number>`count(*)` }).from(productions).get();
    await db.update(productions).set({ shortCode: formatCode("PR", (row?.n ?? 0)) }).where(eq(productions.id, productionId));
  } catch { /* best effort */ }
}

/**
 * Mint the next LC code for a licence — the public, shareable reference shown to
 * users and accepted by the Scan Transfers form (deliver against a production
 * licence). Unlike the decorative codes, this is a functional identifier, so the
 * next number is derived from the highest existing LC suffix rather than a row
 * count: that way a number is never reused if a licence is ever deleted.
 */
export async function mintLicenceCode(db: Db, licenceId: string): Promise<void> {
  try {
    const row = await db
      .select({ max: sql<number>`COALESCE(MAX(CAST(SUBSTR(${licences.shortCode}, 4) AS INTEGER)), 0)` })
      .from(licences)
      .where(sql`${licences.shortCode} LIKE 'LC-%'`)
      .get();
    await db
      .update(licences)
      .set({ shortCode: formatCode("LC", (row?.max ?? 0) + 1) })
      .where(eq(licences.id, licenceId));
  } catch { /* best effort */ }
}

/** Assign the next per-talent scan number to a package (renders as S##). */
export async function mintScanNumber(db: Db, packageId: string, talentId: string): Promise<void> {
  try {
    const row = await db
      .select({ n: sql<number>`count(*)` })
      .from(scanPackages)
      .where(eq(scanPackages.talentId, talentId))
      .get();
    await db.update(scanPackages).set({ scanNumber: (row?.n ?? 0) }).where(eq(scanPackages.id, packageId));
  } catch { /* best effort */ }
}

/** Render a scan number as S## (min 2 digits). */
export function formatScan(n: number | null | undefined): string | null {
  if (n == null) return null;
  return `S${String(n).padStart(2, "0")}`;
}

/**
 * Assemble the compound chain code, e.g. IV-AH-0247-PR-0042-S03. Omits any part
 * that isn't available so a partial chain still reads cleanly.
 */
export function formatChainCode(p: {
  actorCode?: string | null;
  productionCode?: string | null;
  scanNumber?: number | null;
}): string {
  const parts = ["IV", p.actorCode, p.productionCode, formatScan(p.scanNumber)].filter(Boolean);
  return parts.join("-");
}
