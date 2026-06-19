import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { totpCredentials, users, licences, scanPackages, scanFiles, downloadEvents, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { downloadRequestEmail } from "@/lib/email/templates";
import { isIndustryRole } from "@/lib/auth/roles";
import type { DualCustodySession } from "../initiate/route";

// POST /api/licences/[id]/download/licensee-2fa
// Licensee completes their TOTP challenge — advances flow to awaiting_talent
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isIndustryRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { code?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (!body.code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const db = getDb();
  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  const dcSession = await kv.get(`dual_custody:${id}`, "json") as DualCustodySession | null;
  if (!dcSession || dcSession.expiresAt < now) {
    return NextResponse.json({ error: "No active download session — please initiate again" }, { status: 409 });
  }
  // Allow initiator OR any member of the org on the licence
  if (dcSession.licenseeId !== session.sub) {
    let authorised = false;
    if (dcSession.organisationId) {
      const [membership] = await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, dcSession.organisationId),
          eq(organisationMembers.userId, session.sub)
        ))
        .limit(1)
        .all();
      authorised = !!membership;
    }
    if (!authorised) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (dcSession.step !== "awaiting_licensee") {
    return NextResponse.json({ step: dcSession.step });
  }

  // Verify licensee TOTP
  const [totp] = await db
    .select({ secret: totpCredentials.secret })
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, session.sub))
    .limit(1)
    .all();

  if (!totp) {
    return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
  }

  if (!verifyTotpCode(totp.secret, body.code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  // Check if talent has pre-authorised this licence (not applicable for AI training licences)
  const licenceRow = await db
    .select({ preauthUntil: licences.preauthUntil, permitAiTraining: licences.permitAiTraining, fileScope: licences.fileScope, downloadCount: licences.downloadCount, validTo: licences.validTo })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  const preauthActive = licenceRow && licenceRow.preauthUntil && licenceRow.preauthUntil > now && !licenceRow.permitAiTraining;

  if (preauthActive && licenceRow) {
    // Auto-complete without requiring talent TOTP
    const DOWNLOAD_TOKEN_TTL = 48 * 60 * 60;
    const tokenExpiry = now + DOWNLOAD_TOKEN_TTL;

    const files = await db
      .select({ id: scanFiles.id, filename: scanFiles.filename })
      .from(scanFiles)
      .where(eq(scanFiles.packageId, dcSession.packageId))
      .all();

    const scopedFiles = licenceRow.fileScope === "all"
      ? files
      : files.filter(f => {
          try { return (JSON.parse(licenceRow.fileScope) as string[]).includes(f.id); }
          catch { return true; }
        });

    const downloadTokens: Array<{ fileId: string; filename: string; token: string }> = [];
    for (const file of scopedFiles) {
      const token = crypto.randomUUID();
      await kv.put(`dl_token:${token}`, JSON.stringify({ licenceId: id, fileId: file.id, licenseeId: dcSession.licenseeId, expiresAt: tokenExpiry }), { expirationTtl: DOWNLOAD_TOKEN_TTL });
      downloadTokens.push({ fileId: file.id, filename: file.filename, token });
    }

    const completed: DualCustodySession = { ...dcSession, step: "complete", completedByLicenseeId: session.sub, downloadTokens };
    const ttl = dcSession.expiresAt - now;
    await kv.put(`dual_custody:${id}`, JSON.stringify(completed), { expirationTtl: ttl });

    await db.update(licences).set({ downloadCount: (licenceRow.downloadCount ?? 0) + 1, lastDownloadAt: now }).where(eq(licences.id, id));

    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;
    for (const file of scopedFiles) {
      await db.insert(downloadEvents).values({ id: crypto.randomUUID(), licenceId: id, licenseeId: session.sub, fileId: file.id, ip, userAgent, startedAt: now });
    }

    return NextResponse.json({ step: "complete", downloadTokens });
  }

  const updated: DualCustodySession = { ...dcSession, step: "awaiting_talent", completedByLicenseeId: session.sub };
  const ttl = dcSession.expiresAt - now;
  await kv.put(`dual_custody:${id}`, JSON.stringify(updated), { expirationTtl: ttl });

  // Notify talent/rep that their authorisation is required (fire-and-forget)
  void (async () => {
    const db = getDb();
    const [talentUser, licenseeUser, licenceRow, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.talentId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.licenseeId)).get(),
      db.select({ projectName: licences.projectName }).from(licences).where(eq(licences.id, id)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, dcSession.packageId)).get(),
    ]);
    if (!talentUser?.email || !licenceRow || !pkg) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = downloadRequestEmail({
      talentEmail: talentUser.email,
      licenseeEmail: licenseeUser?.email ?? "Unknown",
      projectName: licenceRow.projectName,
      packageName: pkg.name,
      authoriseUrl: `${baseUrl}/vault/licences`,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ step: "awaiting_talent" });
}
