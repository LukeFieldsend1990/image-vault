// Consent eventing + projection (SPEC §16.7).
//
// Granting/revoking consent appends to the hash-chained ledger AND maintains the
// consent_records current-state projection. Consent is never mutated in place — a
// revoke appends a `consent.revoked` event and flips the projection row's status.

import { and, desc, eq } from "drizzle-orm";
import { appendEvent, licenceChain } from "./ledger";
import { complianceEvents, consentRecords } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { ComplianceScope, EvaluatedEvent } from "./types";

type Db = ReturnType<typeof getDb>;

export interface GrantConsentParams {
  db: Db;
  licenceId: string;
  talentId: string;
  actorId: string;
  useType: string; // licenceType value, or any string for a dub
  territory?: string | null;
  language?: string | null; // presence ⇒ a 39.D dub-language consent
  validFrom?: number | null;
  validTo?: number | null;
  scriptedAlterations?: boolean;
  ip?: string | null;
  ua?: string | null;
}

export async function grantConsent(p: GrantConsentParams): Promise<{ eventId: string; recordId: string }> {
  const isDub = typeof p.language === "string" && p.language.length > 0;
  const scope: ComplianceScope = { useType: p.useType };
  if (p.territory) scope.territory = p.territory;
  if (isDub) scope.language = p.language as string;
  if (p.validFrom != null) scope.validFrom = p.validFrom;
  if (p.validTo != null) scope.validTo = p.validTo;
  if (p.scriptedAlterations) scope.scriptedAlterations = true;

  const ev = await appendEvent(p.db, {
    chainKey: licenceChain(p.licenceId),
    eventType: isDub ? "consent.dub_language_granted" : "consent.granted",
    clauseRef: isDub ? "39.D" : "39.B",
    licenceId: p.licenceId,
    talentId: p.talentId,
    actorId: p.actorId,
    scope,
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });

  const recordId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await p.db.insert(consentRecords).values({
    id: recordId,
    licenceId: p.licenceId,
    talentId: p.talentId,
    useType: p.useType,
    territory: p.territory ?? null,
    language: isDub ? (p.language as string) : null,
    validFrom: p.validFrom ?? null,
    validTo: p.validTo ?? null,
    status: "granted",
    grantedEventId: ev.id,
    revokedEventId: null,
    updatedAt: now,
  });

  return { eventId: ev.id, recordId };
}

export async function revokeConsent(
  db: Db,
  args: { recordId: string; actorId: string; ip?: string | null; ua?: string | null },
): Promise<{ eventId: string } | null> {
  const rec = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.id, args.recordId))
    .get();
  if (!rec || rec.status !== "granted") return null;

  const isDub = !!rec.language;
  const scope: ComplianceScope = { useType: rec.useType };
  if (rec.territory) scope.territory = rec.territory;
  if (rec.language) scope.language = rec.language;

  const ev = await appendEvent(db, {
    chainKey: licenceChain(rec.licenceId),
    eventType: "consent.revoked",
    clauseRef: isDub ? "39.D" : "39.B",
    licenceId: rec.licenceId,
    talentId: rec.talentId,
    actorId: args.actorId,
    scope,
    ipAddress: args.ip ?? null,
    userAgent: args.ua ?? null,
  });

  await db
    .update(consentRecords)
    .set({ status: "revoked", revokedEventId: ev.id, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(consentRecords.id, args.recordId));

  return { eventId: ev.id };
}

export async function listConsentRecords(db: Db, licenceId: string) {
  return db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.licenceId, licenceId))
    .all();
}

// Consent events for a licence chain, newest first — feeds the history view and
// (later) obligation evaluation.
export async function listConsentEvents(db: Db, licenceId: string): Promise<EvaluatedEvent[]> {
  const rows = await db
    .select({ eventType: complianceEvents.eventType, scopeJson: complianceEvents.scopeJson })
    .from(complianceEvents)
    .where(and(eq(complianceEvents.licenceId, licenceId), eq(complianceEvents.chainKey, licenceChain(licenceId))))
    .orderBy(desc(complianceEvents.seq))
    .all();
  return rows.map((r) => ({
    eventType: r.eventType,
    scope: safeParse(r.scopeJson),
  }));
}

function safeParse(json: string): ComplianceScope {
  try {
    return JSON.parse(json) as ComplianceScope;
  } catch {
    return {};
  }
}
