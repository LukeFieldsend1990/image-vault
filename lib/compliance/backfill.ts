// Self-healing backfill for approval-derived compliance events.
//
// When a licence is approved (by talent OR rep — a rep agreeing on the talent's
// behalf IS the talent's consent), the approve route auto-fires four ledger
// events: consent (39.B), biometric isolation (39.E), security custody (39.H)
// and the business reason (39.J). These were historically written via a bare
// fire-and-forget IIFE, which the edge runtime can drop after the response is
// sent — leaving an approved licence with no events, so the dashboard shows
// 39.B/E/H as false "critical" gaps.
//
// This module re-appends any of those events that are missing. It is idempotent
// (only writes event types absent from the chain) so it is safe to run on the
// approve path defensively and to expose as an admin maintenance action.

import { eq, inArray } from "drizzle-orm";
import { complianceEvents, licences, usageEvents } from "@/lib/db/schema";
import { appendEvent, licenceChain } from "./ledger";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface BackfillLicence {
  id: string;
  talentId: string;
  licenceType: string | null;
  territory: string | null;
  projectName: string;
  productionCompany: string | null;
  intendedUse: string | null;
}

// Licences that have passed through an approved state and so should carry the
// approval-derived obligations. SCRUB_PERIOD / EXPIRED / CLOSED were all active
// at some point; REVOKED / DENIED never were.
export const BACKFILLABLE_STATUSES = ["APPROVED", "SCRUB_PERIOD", "EXPIRED", "CLOSED"] as const;

// Append any approval-derived events missing for a single licence. Idempotent.
// Returns the number of events appended.
export async function backfillApprovalEvents(
  db: Db,
  licence: BackfillLicence,
  opts?: { actorId?: string | null; hasUsage?: boolean },
): Promise<number> {
  const existing = await db
    .select({ eventType: complianceEvents.eventType })
    .from(complianceEvents)
    .where(eq(complianceEvents.licenceId, licence.id))
    .all();
  const have = new Set(existing.map((e) => e.eventType));

  const chain = licenceChain(licence.id);
  const useType = licence.licenceType ?? "commercial";
  const scope = licence.territory ? { useType, territory: licence.territory } : { useType };
  const actorId = opts?.actorId ?? null;
  let appended = 0;

  if (!have.has("consent.granted")) {
    await appendEvent(db, {
      chainKey: chain, eventType: "consent.granted", clauseRef: "39.B",
      licenceId: licence.id, talentId: licence.talentId, actorId, scope,
    });
    appended++;
  }
  if (!have.has("biometric.isolation_attested")) {
    await appendEvent(db, {
      chainKey: chain, eventType: "biometric.isolation_attested", clauseRef: "39.E",
      licenceId: licence.id, talentId: licence.talentId, actorId: null,
      payload: { note: "ImageVault platform guarantee — biometric data never leaves R2 custody — backfilled" },
    });
    appended++;
  }
  if (!have.has("security.custody_attested")) {
    await appendEvent(db, {
      chainKey: chain, eventType: "security.custody_attested", clauseRef: "39.H",
      licenceId: licence.id, talentId: licence.talentId, actorId: null,
      payload: { note: "ImageVault platform guarantee — all delivery via dual-custody download or bridge — backfilled" },
    });
    appended++;
  }
  if (!have.has("business_reason.recorded")) {
    await appendEvent(db, {
      chainKey: chain, eventType: "business_reason.recorded", clauseRef: "39.J",
      licenceId: licence.id, talentId: licence.talentId, actorId,
      payload: {
        projectName: licence.projectName,
        productionCompany: licence.productionCompany,
        licenceType: licence.licenceType,
        ...(licence.intendedUse ? { intendedUse: licence.intendedUse } : {}),
      },
    });
    appended++;
  }
  if (opts?.hasUsage && !have.has("use.metered")) {
    await appendEvent(db, {
      chainKey: chain, eventType: "use.metered", clauseRef: "39.C",
      licenceId: licence.id, talentId: licence.talentId, actorId: null,
      payload: { note: "Backfilled — pre-existing usage events" },
    });
    appended++;
  }
  return appended;
}

// Scan every approved (or post-approval) licence and backfill missing events.
export async function backfillAllApprovedLicences(
  db: Db,
): Promise<{ licencesProcessed: number; eventsAppended: number }> {
  const rows = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenceType: licences.licenceType,
      territory: licences.territory,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
    })
    .from(licences)
    .where(inArray(licences.status, [...BACKFILLABLE_STATUSES]))
    .all();
  if (rows.length === 0) return { licencesProcessed: 0, eventsAppended: 0 };

  const ids = rows.map((r) => r.id);
  const usage = await db
    .select({ licenceId: usageEvents.licenceId })
    .from(usageEvents)
    .where(inArray(usageEvents.licenceId, ids))
    .all();
  const hasUsage = new Set(usage.map((u) => u.licenceId));

  let eventsAppended = 0;
  for (const r of rows) {
    eventsAppended += await backfillApprovalEvents(db, r, { hasUsage: hasUsage.has(r.id) });
  }
  return { licencesProcessed: rows.length, eventsAppended };
}
