import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, users, scanPackages, talentReps, productionCast } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceDeniedEmail } from "@/lib/email/templates";
import { createNotification } from "@/lib/notifications/create";
import { appendEventBg, licenceChain } from "@/lib/compliance/emit-bg";

// POST /api/licences/[id]/deny — talent/rep denies a pending licence request
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

  let body: { reason?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* no body is fine */ }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [licence] = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      packageId: licences.packageId,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
  // Both states represent a request the talent has not yet agreed to:
  // PENDING (licensee asked for an existing package) and AWAITING_PACKAGE
  // (production cast invitation, scan not yet attached). Either can be declined.
  if (licence.status !== "PENDING" && licence.status !== "AWAITING_PACKAGE") {
    return NextResponse.json({ error: "Licence is not awaiting your review" }, { status: 409 });
  }
  const licencePackageId = licence.packageId;

  await db
    .update(licences)
    .set({ status: "DENIED", deniedAt: now, deniedReason: body.reason ?? null })
    .where(eq(licences.id, id));

  // Record the refusal in the compliance ledger (chain of custody).
  appendEventBg(db, {
    chainKey: licenceChain(id), eventType: "licence.denied", clauseRef: "39.B",
    licenceId: id, talentId: licence.talentId, actorId: session.sub,
    payload: { reason: body.reason ?? null, byRole: session.role },
  });

  // Mirror the accept-invite flow: if this licence is backed by a production
  // cast row, mark it declined so the production sees the response.
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
          .set({ status: "declined" })
          .where(eq(productionCast.id, castRow.id));
      }
    } catch { /* non-fatal */ }
  })();

  // Notify licensee (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      licencePackageId
        ? db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licencePackageId)).get()
        : Promise.resolve(null),
    ]);
    if (!licenseeUser?.email) return;
    const { subject, html } = licenceDeniedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: pkg?.name ?? licencePackageId ?? "Placeholder",
      reason: body.reason ?? null,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
    await createNotification(db, {
      userId: licence.licenseeId,
      type: "licence_denied",
      title: "Licence request declined",
      body: licence.projectName,
      href: `/licences`,
    });
  })();

  return NextResponse.json({ ok: true });
}
