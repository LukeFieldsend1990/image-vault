export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  licences,
  scanPackages,
  scrubAttestations,
  talentReps,
  totpCredentials,
  users,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { eq, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { attestationSubmittedEmail } from "@/lib/email/templates";

const ATTESTATION_TEXT = `I confirm that all copies of the scan data licensed under this agreement have been permanently deleted from every device, storage system, and backup under my or my company's control. I understand that this attestation is a legally binding statement and that submitting a false attestation may result in civil or criminal liability.`;

type Body = {
  devicesScrubbed?: unknown;
  additionalNotes?: unknown;
  bridgeCachePurged?: unknown;
  totp?: unknown;
};

// POST /api/licences/[id]/scrub/attest
// Licensee submits the deletion attestation. Requires TOTP.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "licensee") {
    return NextResponse.json({ error: "Only the licensee can submit the attestation" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const totpCode = typeof body.totp === "string" ? body.totp.trim() : "";
  if (!totpCode) {
    return NextResponse.json({ error: "TOTP code is required" }, { status: 400 });
  }

  const devices = Array.isArray(body.devicesScrubbed)
    ? body.devicesScrubbed.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim())
    : [];
  if (devices.length === 0) {
    return NextResponse.json({ error: "At least one device must be listed" }, { status: 400 });
  }

  const additionalNotes = typeof body.additionalNotes === "string" ? body.additionalNotes.slice(0, 2000) : null;
  const bridgeCachePurged = body.bridgeCachePurged === true;

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
  if (lic.licenseeId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (lic.status !== "SCRUB_PERIOD" && lic.status !== "OVERDUE") {
    return NextResponse.json(
      { error: `Licence is ${lic.status} — attestation is only available during the scrub period` },
      { status: 409 },
    );
  }

  // TOTP verification
  const totp = await db
    .select({ secret: totpCredentials.secret })
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, session.sub))
    .get();
  if (!totp) {
    return NextResponse.json({ error: "2FA not configured on this account" }, { status: 400 });
  }
  if (!verifyTotpCode(totp.secret, totpCode)) {
    return NextResponse.json({ error: "Invalid TOTP code" }, { status: 401 });
  }

  const ipAddress = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const attestationId = crypto.randomUUID();

  await db.insert(scrubAttestations).values({
    id: attestationId,
    licenceId: id,
    attestedBy: session.sub,
    attestedAt: now,
    attestationText: ATTESTATION_TEXT,
    ipAddress,
    userAgent,
    devicesScrubbed: JSON.stringify(devices),
    bridgeCachePurged,
    additionalNotes,
    createdAt: now,
  });

  await db
    .update(licences)
    .set({ status: "CLOSED", scrubAttestedAt: now })
    .where(eq(licences.id, id));

  // Notify talent (+ any reps) + admins — fire-and-forget
  void (async () => {
    const [licenseeUser, pkg, repLinks] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, lic.licenseeId)).get(),
      lic.packageId
        ? db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, lic.packageId)).get()
        : Promise.resolve(null),
      db.select({ repId: talentReps.repId }).from(talentReps).where(eq(talentReps.talentId, lic.talentId)).all(),
    ]);

    const recipientIds = new Set<string>([lic.talentId, ...repLinks.map((r) => r.repId)]);
    const recipientEmails = recipientIds.size
      ? await db
          .select({ email: users.email })
          .from(users)
          .where(inArray(users.id, Array.from(recipientIds)))
          .all()
      : [];

    const emails = new Set<string>([
      ...recipientEmails.map((r) => r.email).filter((e): e is string => !!e),
      ...ADMIN_EMAILS,
    ]);

    for (const to of emails) {
      const { subject, html } = attestationSubmittedEmail({
        recipientEmail: to,
        projectName: lic.projectName,
        packageName: pkg?.name ?? lic.packageId ?? "(no package)",
        licenseeEmail: licenseeUser?.email ?? "unknown",
        attestedAt: now,
        devicesCount: devices.length,
      });
      await sendEmail({ to, subject, html });
    }
  })();

  return NextResponse.json({
    ok: true,
    attestationId,
    status: "CLOSED",
    attestedAt: now,
  });
}
