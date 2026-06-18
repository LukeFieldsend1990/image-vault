// Insurer risk-monitoring notifications (Phase 8 §4.5). Insurers price at bind but
// bleed money when risk drifts mid-policy, so we push an in-app notification to the
// scoped insurer(s) when *their* production crosses a risk threshold: a strike is
// declared, or a Bridge tamper/critical event lands. Strictly scoped — an insurer
// is only ever notified about a production their active grant covers.

import { and, eq, isNull } from "drizzle-orm";
import { complianceGrants, licences, productions } from "@/lib/db/schema";
import { createNotification } from "./create";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

interface RiskNotification {
  type: string;
  title: string;
  body?: string | null;
}

/** The compliance users holding an active insurer grant on a production. */
async function insurersForProduction(db: Db, productionId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: complianceGrants.complianceUserId })
    .from(complianceGrants)
    .where(
      and(
        eq(complianceGrants.subtype, "insurer"),
        eq(complianceGrants.scope, "production"),
        eq(complianceGrants.scopeId, productionId),
        isNull(complianceGrants.revokedAt),
      ),
    )
    .all();
  return [...new Set(rows.map((r) => r.userId))];
}

/**
 * Notify every insurer covering a production. Best-effort: links each insurer to
 * their underwriting view of that production. Safe to call fire-and-forget.
 */
export async function notifyInsurersForProduction(
  db: Db,
  productionId: string,
  n: RiskNotification,
): Promise<void> {
  try {
    const userIds = await insurersForProduction(db, productionId);
    if (userIds.length === 0) return;
    const href = `/underwriting?production=${productionId}`;
    await Promise.all(userIds.map((userId) => createNotification(db, { ...n, userId, href })));
  } catch {
    // best-effort — monitoring must never break the action that triggered it
  }
}

/**
 * Resolve a strike's scope to the affected production(s) and notify their insurers.
 * Global strikes are platform-wide (not bound to one production) so are skipped —
 * an insurer's visibility is per-production by design.
 */
export async function notifyInsurersOfStrike(
  db: Db,
  strike: { scope: string; scopeId: string | null; reason: string },
): Promise<void> {
  try {
    let productionIds: string[] = [];
    if (strike.scope === "production" && strike.scopeId) {
      productionIds = [strike.scopeId];
    } else if (strike.scope === "licence" && strike.scopeId) {
      const lic = await db
        .select({ productionId: licences.productionId })
        .from(licences)
        .where(eq(licences.id, strike.scopeId))
        .get();
      if (lic?.productionId) productionIds = [lic.productionId];
    } else if (strike.scope === "organisation" && strike.scopeId) {
      const rows = await db
        .select({ id: productions.id })
        .from(productions)
        .where(eq(productions.organisationId, strike.scopeId))
        .all();
      productionIds = rows.map((r) => r.id);
    }
    if (productionIds.length === 0) return;

    await Promise.all(
      productionIds.map((pid) =>
        notifyInsurersForProduction(db, pid, {
          type: "insurer_risk_strike",
          title: "Strike declared on a covered production",
          body: strike.reason ? `Reason: ${strike.reason}` : null,
        }),
      ),
    );
  } catch {
    // best-effort
  }
}

/**
 * Notify insurers of a Bridge integrity event on a package tied to a production
 * they cover. Resolves the production via any licence on the package (a package is
 * the cast member's scan; its licences carry the productionId).
 */
export async function notifyInsurersOfBridgeEvent(
  db: Db,
  ev: { packageId: string; eventType: string; severity: string },
): Promise<void> {
  try {
    const licRows = await db
      .select({ productionId: licences.productionId })
      .from(licences)
      .where(eq(licences.packageId, ev.packageId))
      .all();
    const productionIds = [...new Set(licRows.map((l) => l.productionId).filter((p): p is string => !!p))];
    if (productionIds.length === 0) return;

    const label = ev.eventType.replace(/_/g, " ");
    await Promise.all(
      productionIds.map((pid) =>
        notifyInsurersForProduction(db, pid, {
          type: "insurer_risk_bridge",
          title: `Bridge ${ev.severity === "critical" ? "critical alert" : "alert"} on a covered production`,
          body: `Integrity event: ${label}. Review the device custody log.`,
        }),
      ),
    );
  } catch {
    // best-effort
  }
}

/** Bridge event types that warrant an insurer alert regardless of severity. */
export const INSURER_ALERT_BRIDGE_EVENTS = new Set([
  "tamper_detected",
  "unexpected_copy",
  "hash_mismatch",
  "re_access_denied",
]);

/** Whether a bridge event should fan out to insurers (cyber-risk signal). */
export function isInsurerAlertBridgeEvent(eventType: string, severity: string): boolean {
  return severity === "critical" || INSURER_ALERT_BRIDGE_EVENTS.has(eventType);
}
