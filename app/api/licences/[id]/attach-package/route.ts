import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users, talentReps, productionCast, geometryFingerprintJobs } from "@/lib/db/schema";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { packageAttachedEmail } from "@/lib/email/templates";
import { isIndustryRole } from "@/lib/auth/roles";
import { appendEventBg, licenceChain } from "@/lib/compliance/emit-bg";

// PATCH /api/licences/[id]/attach-package
// Attaches a scan package to a placeholder licence (status AWAITING_PACKAGE)
// and transitions it to PENDING for talent/rep approval.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (
    session.role !== "talent" &&
    session.role !== "rep" &&
    session.role !== "admin" &&
    !isIndustryRole(session.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { packageId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId } = body;
  if (!packageId) {
    return NextResponse.json({ error: "packageId is required" }, { status: 400 });
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
  } else if (session.role === "talent" && licence.talentId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (isIndustryRole(session.role) && session.sub !== licence.licenseeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (licence.status !== "AWAITING_PACKAGE" && licence.status !== "PENDING" && licence.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Cannot attach a package to a licence in this state" },
      { status: 409 }
    );
  }

  const [pkg] = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      status: scanPackages.status,
      deletedAt: scanPackages.deletedAt,
      name: scanPackages.name,
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .limit(1)
    .all();

  if (!pkg || pkg.deletedAt) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }
  if (pkg.talentId !== licence.talentId) {
    return NextResponse.json(
      { error: "Package does not belong to the talent on this licence" },
      { status: 409 }
    );
  }
  if (pkg.status !== "ready") {
    return NextResponse.json(
      { error: "Package is not ready — upload must be complete first" },
      { status: 409 }
    );
  }

  await db
    .update(licences)
    .set({
      packageId,
      // Only advance status for AWAITING_PACKAGE; PENDING/APPROVED already past that gate
      ...(licence.status === "AWAITING_PACKAGE" ? { status: "PENDING" as const } : {}),
    })
    .where(eq(licences.id, id));

  // Record the scan attachment in the compliance ledger (chain of custody).
  appendEventBg(db, {
    chainKey: licenceChain(id), eventType: "package.attached",
    licenceId: id, talentId: licence.talentId, actorId: session.sub,
    payload: { packageId, packageName: pkg.name, byRole: session.role },
  });

  // Update production_cast status if a cast row references this licence
  void (async () => {
    const castRow = await db
      .select({ id: productionCast.id })
      .from(productionCast)
      .where(eq(productionCast.licenceId, id))
      .get();
    if (castRow) {
      await db
        .update(productionCast)
        .set({ status: "scan_uploaded" })
        .where(eq(productionCast.id, castRow.id));
    }
  })();

  // Trigger geo-fingerprint job for APPROVED licences (fire-and-forget)
  void (async () => {
    if (licence.status !== "APPROVED") return;
    try {
      const talentUser = await db
        .select({ geoFingerprintEnabled: users.geoFingerprintEnabled })
        .from(users)
        .where(eq(users.id, licence.talentId))
        .get();
      if (!talentUser?.geoFingerprintEnabled) return;
      const jobId = crypto.randomUUID();
      await db.insert(geometryFingerprintJobs).values({
        id: jobId, licenceId: id, packageId, status: "queued", createdAt: now,
      });
      const { env } = getCloudflareContext();
      const queue = (env as unknown as Record<string, Queue>)["GEO_FINGERPRINT_QUEUE"];
      if (queue) await queue.send({ jobId });
    } catch { /* non-fatal */ }
  })();

  void (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const [licenseeUser, talentUser] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.talentId)).get(),
    ]);

    if (licenseeUser?.email) {
      const { subject, html } = packageAttachedEmail({
        recipientEmail: licenseeUser.email,
        projectName: licence.projectName,
        packageName: pkg.name,
        role: "industry",
        viewUrl: `${baseUrl}/licences`,
      });
      await sendEmail({ to: licenseeUser.email, subject, html });
    }

    // Notify talent/rep if the attacher was someone else (admin ingesting scans)
    if (talentUser?.email && session.sub !== licence.talentId) {
      const { subject, html } = packageAttachedEmail({
        recipientEmail: talentUser.email,
        projectName: licence.projectName,
        packageName: pkg.name,
        role: "talent",
        viewUrl: `${baseUrl}/vault/licences`,
      });
      await sendEmail({ to: talentUser.email, subject, html });
    }
  })();

  return NextResponse.json({ ok: true, status: "PENDING" });
}
