import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, users, talentReps, productionCast } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceApprovedEmail } from "@/lib/email/templates";
import { appendEvent, licenceChain } from "@/lib/compliance/ledger";
import { getRequestContext } from "@cloudflare/next-on-pages";

// POST /api/licences/[id]/accept-invite
// Talent accepts a production cast invitation without a scan package.
// Transitions AWAITING_PACKAGE → APPROVED and records consent.
// The scan can be attached later via PATCH /api/licences/[id]/attach-package.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent" && session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [licence] = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      proposedFee: licences.proposedFee,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      licenceType: licences.licenceType,
      territory: licences.territory,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, licence.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role !== "admin" && licence.talentId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (licence.status !== "AWAITING_PACKAGE") {
    return NextResponse.json({ error: "Licence is not in AWAITING_PACKAGE state" }, { status: 409 });
  }

  const agreedFee = licence.proposedFee ?? null;
  const platformFee = agreedFee !== null ? Math.round(agreedFee * 0.15) : null;

  await db
    .update(licences)
    .set({ status: "APPROVED", approvedBy: session.sub, approvedAt: now, agreedFee, platformFee })
    .where(eq(licences.id, id));

  // Mark productionCast row as consented (fire-and-forget, non-fatal)
  void (async () => {
    try {
      const castRow = await db
        .select({ id: productionCast.id })
        .from(productionCast)
        .where(eq(productionCast.licenceId, id))
        .get();
      if (castRow) {
        await db
          .update(productionCast)
          .set({ status: "consented", linkedAt: now })
          .where(eq(productionCast.id, castRow.id));
      }
    } catch { /* non-fatal */ }
  })();

  // Record consent in compliance ledger. Run under ctx.waitUntil so the ledger
  // writes survive past the response — a bare fire-and-forget can be dropped on
  // the edge, leaving an accepted licence with no consent events (false gaps).
  const recordConsentEvents = (async () => {
    try {
      const chain = licenceChain(id);
      const useType = licence.licenceType ?? "commercial";
      const scope = licence.territory ? { useType, territory: licence.territory } : { useType };
      await appendEvent(db, {
        chainKey: chain, eventType: "consent.granted", clauseRef: "39.B",
        licenceId: id, talentId: licence.talentId, actorId: session.sub, scope,
      });
      await appendEvent(db, {
        chainKey: chain, eventType: "biometric.isolation_attested", clauseRef: "39.E",
        licenceId: id, talentId: licence.talentId, actorId: null,
        payload: { note: "Image Vault platform guarantee — biometric data never leaves R2 custody" },
      });
    } catch { /* non-fatal */ }
  })();
  try {
    getRequestContext().ctx.waitUntil(recordConsentEvents);
  } catch {
    void recordConsentEvents; // local dev — no request context
  }

  // Notify licensee (fire-and-forget)
  void (async () => {
    const licenseeUser = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, licence.licenseeId))
      .get();
    if (!licenseeUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = licenceApprovedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: "Scan pending — talent accepted invitation",
      validFrom: licence.validFrom,
      validTo: licence.validTo,
      downloadUrl: `${baseUrl}/licences`,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
  })();

  return NextResponse.json({ ok: true });
}
