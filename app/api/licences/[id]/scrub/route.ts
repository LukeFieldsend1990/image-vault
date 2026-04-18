export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scrubAttestations, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, desc, eq } from "drizzle-orm";

// GET /api/licences/[id]/scrub
// Returns scrub status for any party on the licence + admin.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const lic = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      scrubDeadline: licences.scrubDeadline,
      scrubAttestedAt: licences.scrubAttestedAt,
      revokedAt: licences.revokedAt,
      validTo: licences.validTo,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!lic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let authorized =
    isAdmin(session.email) ||
    lic.talentId === session.sub ||
    lic.licenseeId === session.sub;

  if (!authorized && session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, lic.talentId)))
      .get();
    if (link) authorized = true;
  }
  if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const attestation = await db
    .select({
      id: scrubAttestations.id,
      attestedBy: scrubAttestations.attestedBy,
      attestedAt: scrubAttestations.attestedAt,
      attestationText: scrubAttestations.attestationText,
      devicesScrubbed: scrubAttestations.devicesScrubbed,
      bridgeCachePurged: scrubAttestations.bridgeCachePurged,
      additionalNotes: scrubAttestations.additionalNotes,
      ipAddress: scrubAttestations.ipAddress,
    })
    .from(scrubAttestations)
    .where(eq(scrubAttestations.licenceId, id))
    .orderBy(desc(scrubAttestations.attestedAt))
    .get();

  const now = Math.floor(Date.now() / 1000);
  const deadline = lic.scrubDeadline;
  const daysRemaining = deadline ? Math.ceil((deadline - now) / 86400) : null;
  const overdue =
    lic.status === "SCRUB_PERIOD" && deadline !== null && deadline < now;

  return NextResponse.json({
    licenceId: lic.id,
    status: lic.status,
    projectName: lic.projectName,
    scrubDeadline: deadline,
    daysRemaining,
    overdue,
    scrubAttestedAt: lic.scrubAttestedAt,
    attestation: attestation
      ? {
          attestedBy: attestation.attestedBy,
          attestedAt: attestation.attestedAt,
          attestationText: attestation.attestationText,
          devicesScrubbed: attestation.devicesScrubbed
            ? JSON.parse(attestation.devicesScrubbed) as unknown
            : null,
          bridgeCachePurged: attestation.bridgeCachePurged,
          additionalNotes: attestation.additionalNotes,
          ipAddress: attestation.ipAddress,
        }
      : null,
  });
}
