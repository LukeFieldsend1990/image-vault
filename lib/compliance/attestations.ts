// Security / biometric attestations (SPEC §16.9) — Article 39.E & 39.H.
//
// A producer attests biometric isolation (39.E) or commercially-reasonable
// custody (39.H). Each attestation is a compliance_attestations row plus a ledger
// event, so it both shows in the obligation matrix and seals into the certificate.

import { desc, eq } from "drizzle-orm";
import { appendEvent, licenceChain } from "./ledger";
import { complianceAttestations } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export type AttestationType = "biometric_isolation" | "security_custody";

const EVENT: Record<AttestationType, { eventType: string; clauseRef: string }> = {
  biometric_isolation: { eventType: "biometric.isolation_attested", clauseRef: "39.E" },
  security_custody: { eventType: "security.custody_attested", clauseRef: "39.H" },
};

export interface RecordAttestationParams {
  licenceId: string;
  organisationId?: string | null;
  attestationType: AttestationType;
  attestedBy: string;
  attestationText: string;
  ip?: string | null;
  ua?: string | null;
}

export async function recordAttestation(
  db: Db,
  p: RecordAttestationParams,
): Promise<{ id: string; eventId: string }> {
  const { eventType, clauseRef } = EVENT[p.attestationType];

  const ev = await appendEvent(db, {
    chainKey: licenceChain(p.licenceId),
    eventType,
    clauseRef,
    licenceId: p.licenceId,
    organisationId: p.organisationId ?? null,
    actorId: p.attestedBy,
    payload: { attestationType: p.attestationType },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });

  const id = crypto.randomUUID();
  await db.insert(complianceAttestations).values({
    id,
    licenceId: p.licenceId,
    organisationId: p.organisationId ?? null,
    attestationType: p.attestationType,
    attestedBy: p.attestedBy,
    attestationText: p.attestationText,
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
    eventId: ev.id,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return { id, eventId: ev.id };
}

export async function listAttestations(db: Db, licenceId: string) {
  return db
    .select()
    .from(complianceAttestations)
    .where(eq(complianceAttestations.licenceId, licenceId))
    .orderBy(desc(complianceAttestations.createdAt))
    .all();
}
