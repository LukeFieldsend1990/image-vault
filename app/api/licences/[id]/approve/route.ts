export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, users, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceApprovedEmail } from "@/lib/email/templates";

// POST /api/licences/[id]/approve — talent/rep approves a pending licence request
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
      packageId: licences.packageId,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (licence.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "PENDING") {
    return NextResponse.json({ error: "Licence is not in PENDING state" }, { status: 409 });
  }

  await db
    .update(licences)
    .set({ status: "APPROVED", approvedBy: session.sub, approvedAt: now })
    .where(eq(licences.id, id));

  // Notify licensee (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licence.packageId)).get(),
    ]);
    if (!licenseeUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = licenceApprovedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: pkg?.name ?? licence.packageId,
      validFrom: licence.validFrom,
      validTo: licence.validTo,
      downloadUrl: `${baseUrl}/licences`,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
  })();

  return NextResponse.json({ ok: true });
}
