export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, scanFiles, totpCredentials, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { eq } from "drizzle-orm";
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

  let body: { code?: string } = {};
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

  // Fetch the licence to get file_scope
  const [licence] = await db
    .select({ fileScope: licences.fileScope, downloadCount: licences.downloadCount })
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

  // Update licence stats
  await db
    .update(licences)
    .set({
      downloadCount: (licence.downloadCount ?? 0) + 1,
      lastDownloadAt: now,
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

  return NextResponse.json({ step: "complete", downloadTokens });
}
