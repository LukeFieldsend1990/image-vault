export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, users, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceRevokedEmail } from "@/lib/email/templates";

// POST /api/licences/[id]/revoke — talent/rep revokes an approved licence
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
  const kv = getKv();
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
  if (licence.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Only APPROVED licences can be revoked" }, { status: 409 });
  }

  // Kill any active dual-custody session in KV
  await kv.delete(`dual_custody:${id}`);

  await db
    .update(licences)
    .set({ status: "REVOKED", revokedAt: now })
    .where(eq(licences.id, id));

  // Notify licensee (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licence.packageId)).get(),
    ]);
    if (!licenseeUser?.email) return;
    const { subject, html } = licenceRevokedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: pkg?.name ?? licence.packageId,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
  })();

  return NextResponse.json({ ok: true });
}
