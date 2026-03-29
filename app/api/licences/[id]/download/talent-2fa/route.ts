export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, scanFiles, totpCredentials, downloadEvents, users, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { downloadCompleteEmail } from "@/lib/email/templates";
import type { DualCustodySession } from "../initiate/route";

const DOWNLOAD_TOKEN_TTL = 48 * 60 * 60; // 48 hours in seconds

// POST /api/licences/[id]/download/talent-2fa
// Talent completes their TOTP challenge — generates download tokens and completes the flow
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

  type PreauthOption = "once" | "7d" | "14d" | "30d" | "licence";
  let body: { code?: string; preauthOption?: PreauthOption } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (!body.code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  const dcSession = await kv.get(`dual_custody:${id}`, "json") as DualCustodySession | null;
  if (!dcSession || dcSession.expiresAt < now) {
    return NextResponse.json({ error: "No active download session" }, { status: 409 });
  }
  if (dcSession.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (dcSession.step !== "awaiting_talent") {
    return NextResponse.json({ step: dcSession.step });
  }

  // Verify talent TOTP
  const db = getDb();
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

  // Fetch the licence to get file_scope and preauth eligibility
  const [licence] = await db
    .select({ fileScope: licences.fileScope, downloadCount: licences.downloadCount, permitAiTraining: licences.permitAiTraining, validTo: licences.validTo })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  }

  // Resolve which files to grant access to
  const fileQuery = db
    .select({ id: scanFiles.id, filename: scanFiles.filename, sizeBytes: scanFiles.sizeBytes })
    .from(scanFiles)
    .where(eq(scanFiles.packageId, dcSession.packageId));

  const files = await fileQuery.all();
  const scopedFiles = licence.fileScope === "all"
    ? files
    : files.filter(f => {
        try {
          const ids = JSON.parse(licence.fileScope) as string[];
          return ids.includes(f.id);
        } catch {
          return true;
        }
      });

  // Generate a short-lived download token per file, store in KV
  const tokenExpiry = now + DOWNLOAD_TOKEN_TTL;
  const downloadTokens: Array<{ fileId: string; filename: string; token: string }> = [];

  for (const file of scopedFiles) {
    const token = crypto.randomUUID();
    await kv.put(
      `dl_token:${token}`,
      JSON.stringify({
        licenceId: id,
        fileId: file.id,
        licenseeId: dcSession.licenseeId,
        expiresAt: tokenExpiry,
      }),
      { expirationTtl: DOWNLOAD_TOKEN_TTL }
    );
    downloadTokens.push({ fileId: file.id, filename: file.filename, token });
  }

  // Mark dual-custody session complete
  const completed: DualCustodySession = { ...dcSession, step: "complete", downloadTokens };
  const ttl = dcSession.expiresAt - now;
  await kv.put(`dual_custody:${id}`, JSON.stringify(completed), { expirationTtl: ttl });

  // Calculate preauth expiry if requested (not available for AI training licences)
  let preauthUntil: number | null = null;
  const opt = body.preauthOption;
  if (opt && opt !== "once" && !licence.permitAiTraining) {
    if (opt === "7d")      preauthUntil = now + 7  * 86400;
    else if (opt === "14d") preauthUntil = now + 14 * 86400;
    else if (opt === "30d") preauthUntil = now + 30 * 86400;
    else if (opt === "licence") preauthUntil = licence.validTo;
  }

  // Update licence stats (and preauth if set)
  await db
    .update(licences)
    .set({
      downloadCount: (licence.downloadCount ?? 0) + 1,
      lastDownloadAt: now,
      ...(preauthUntil !== null ? { preauthUntil, preauthSetBy: session.sub } : {}),
    })
    .where(eq(licences.id, id));

  // Log download events
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  for (const file of scopedFiles) {
    await db.insert(downloadEvents).values({
      id: crypto.randomUUID(),
      licenceId: id,
      licenseeId: dcSession.licenseeId,
      fileId: file.id,
      ip,
      userAgent,
      startedAt: now,
    });
  }

  // Notify both parties (fire-and-forget)
  void (async () => {
    const [licenceRow, licenseeUser, talentUser, pkg] = await Promise.all([
      db.select({ projectName: licences.projectName, packageId: licences.packageId, talentId: licences.talentId })
        .from(licences).where(eq(licences.id, id)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.licenseeId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.talentId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, dcSession.packageId)).get(),
    ]);
    if (!licenceRow || !licenseeUser?.email) return;
    const packageName = pkg?.name ?? dcSession.packageId;
    const params = {
      projectName: licenceRow.projectName,
      packageName,
      licenseeEmail: licenseeUser.email,
      fileCount: scopedFiles.length,
      ip,
      downloadedAt: now,
    };
    await Promise.all([
      sendEmail({
        to: licenseeUser.email,
        ...downloadCompleteEmail({ ...params, recipientEmail: licenseeUser.email, isLicensee: true }),
      }),
      talentUser?.email
        ? sendEmail({
            to: talentUser.email,
            ...downloadCompleteEmail({ ...params, recipientEmail: talentUser.email, isLicensee: false }),
          })
        : Promise.resolve(),
    ]);
  })();

  return NextResponse.json({ step: "complete", downloadTokens });
}
