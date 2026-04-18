export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { attestationExtendedEmail } from "@/lib/email/templates";

const MAX_EXTENSION_DAYS = 30;

// POST /api/licences/[id]/scrub/extend
// Admin-only: grants the licensee more time on an open attestation window.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { additionalDays?: unknown; reason?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const additionalDays = typeof body.additionalDays === "number" ? Math.floor(body.additionalDays) : NaN;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!Number.isFinite(additionalDays) || additionalDays < 1 || additionalDays > MAX_EXTENSION_DAYS) {
    return NextResponse.json(
      { error: `additionalDays must be between 1 and ${MAX_EXTENSION_DAYS}` },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const lic = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      packageId: licences.packageId,
      scrubDeadline: licences.scrubDeadline,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!lic) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lic.status !== "SCRUB_PERIOD" && lic.status !== "OVERDUE") {
    return NextResponse.json(
      { error: `Cannot extend — licence is ${lic.status}` },
      { status: 409 },
    );
  }

  const baseDeadline = lic.scrubDeadline && lic.scrubDeadline > now ? lic.scrubDeadline : now;
  const newDeadline = baseDeadline + additionalDays * 86400;

  await db
    .update(licences)
    .set({
      scrubDeadline: newDeadline,
      // If we were past the old deadline, pull back to SCRUB_PERIOD.
      status: "SCRUB_PERIOD",
    })
    .where(eq(licences.id, id));

  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, lic.licenseeId)).get(),
      lic.packageId
        ? db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, lic.packageId)).get()
        : Promise.resolve(null),
    ]);
    if (!licenseeUser?.email) return;
    const { subject, html } = attestationExtendedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: lic.projectName,
      packageName: pkg?.name ?? lic.packageId ?? "(no package)",
      newDeadline,
      additionalDays,
      reason,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
  })();

  return NextResponse.json({
    ok: true,
    scrubDeadline: newDeadline,
    status: "SCRUB_PERIOD",
  });
}
