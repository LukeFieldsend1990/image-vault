export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { packageAttachedEmail } from "@/lib/email/templates";

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

  if (session.role !== "talent" && session.role !== "rep" && session.role !== "admin") {
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
  }

  if (licence.status !== "AWAITING_PACKAGE") {
    return NextResponse.json(
      { error: "Licence is not awaiting a package" },
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
    .set({ packageId, status: "PENDING" })
    .where(eq(licences.id, id));

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
        role: "licensee",
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
