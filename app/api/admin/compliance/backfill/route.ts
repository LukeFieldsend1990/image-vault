export const runtime = "edge";

// POST /api/admin/compliance/backfill
//
// One-time backfill that retroactively appends missing compliance ledger events
// for licences and usage events that predate the auto-satisfy hooks. Safe to
// re-run — each check queries the ledger first and skips if the event already exists.
//
// Events appended per approved licence (if missing):
//   consent.granted        (39.B) — approval = consent
//   biometric.isolation_attested (39.E) — platform guarantee
//   security.custody_attested    (39.H) — platform guarantee
//   business_reason.recorded     (39.J) — intendedUse already captured
//
// Events appended per licence with usage events (if no use.metered exists):
//   use.metered            (39.C) — one summary event per licence

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, usageEvents, complianceEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { appendEvent, licenceChain } from "@/lib/compliance/ledger";
import { eq, inArray, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();

  // All approved licences
  const approvedLicences = await db
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
    .where(eq(licences.status, "APPROVED"))
    .all();

  const licenceIds = approvedLicences.map((l) => l.id);

  // Fetch existing event types per licence chain in one query
  const existingEvents = licenceIds.length
    ? await db
        .select({ licenceId: complianceEvents.licenceId, eventType: complianceEvents.eventType })
        .from(complianceEvents)
        .where(inArray(complianceEvents.licenceId, licenceIds))
        .all()
    : [];

  // Build a set: `${licenceId}:${eventType}` for fast lookup
  const hasEvent = new Set(existingEvents.map((e) => `${e.licenceId}:${e.eventType}`));

  // Usage event counts per licence
  const usageCounts = licenceIds.length
    ? await db
        .select({ licenceId: usageEvents.licenceId, n: sql<number>`count(*)` })
        .from(usageEvents)
        .where(inArray(usageEvents.licenceId, licenceIds))
        .groupBy(usageEvents.licenceId)
        .all()
    : [];
  const usageCountMap = new Map(usageCounts.map((r) => [r.licenceId, r.n]));

  let appended = 0;
  const errors: string[] = [];

  for (const l of approvedLicences) {
    const chain = licenceChain(l.id);
    const useType = l.licenceType ?? "commercial";
    const scope = l.territory ? { useType, territory: l.territory } : { useType };

    // 39.B
    if (!hasEvent.has(`${l.id}:consent.granted`)) {
      try {
        await appendEvent(db, {
          chainKey: chain, eventType: "consent.granted", clauseRef: "39.B",
          licenceId: l.id, talentId: l.talentId, actorId: "system-backfill", scope,
        });
        appended++;
      } catch (e) { errors.push(`${l.id} 39.B: ${String(e)}`); }
    }

    // 39.E
    if (!hasEvent.has(`${l.id}:biometric.isolation_attested`)) {
      try {
        await appendEvent(db, {
          chainKey: chain, eventType: "biometric.isolation_attested", clauseRef: "39.E",
          licenceId: l.id, talentId: l.talentId, actorId: "platform",
          payload: { note: "Image Vault platform guarantee — backfilled" },
        });
        appended++;
      } catch (e) { errors.push(`${l.id} 39.E: ${String(e)}`); }
    }

    // 39.H
    if (!hasEvent.has(`${l.id}:security.custody_attested`)) {
      try {
        await appendEvent(db, {
          chainKey: chain, eventType: "security.custody_attested", clauseRef: "39.H",
          licenceId: l.id, talentId: l.talentId, actorId: "platform",
          payload: { note: "Image Vault platform guarantee — backfilled" },
        });
        appended++;
      } catch (e) { errors.push(`${l.id} 39.H: ${String(e)}`); }
    }

    // 39.J
    if (!hasEvent.has(`${l.id}:business_reason.recorded`) && l.intendedUse) {
      try {
        await appendEvent(db, {
          chainKey: chain, eventType: "business_reason.recorded", clauseRef: "39.J",
          licenceId: l.id, talentId: l.talentId, actorId: "system-backfill",
          payload: { projectName: l.projectName, productionCompany: l.productionCompany, intendedUse: l.intendedUse },
        });
        appended++;
      } catch (e) { errors.push(`${l.id} 39.J: ${String(e)}`); }
    }

    // 39.C — one summary use.metered event if usage events exist but none is on ledger
    const usageCount = usageCountMap.get(l.id) ?? 0;
    if (usageCount > 0 && !hasEvent.has(`${l.id}:use.metered`)) {
      try {
        await appendEvent(db, {
          chainKey: chain, eventType: "use.metered", clauseRef: "39.C",
          licenceId: l.id, talentId: l.talentId, actorId: "system-backfill",
          payload: { note: `Backfilled — ${usageCount} pre-existing usage event(s)` },
        });
        appended++;
      } catch (e) { errors.push(`${l.id} 39.C: ${String(e)}`); }
    }
  }

  return NextResponse.json({
    ok: true,
    licencesProcessed: approvedLicences.length,
    eventsAppended: appended,
    errors: errors.length ? errors : undefined,
  });
}
