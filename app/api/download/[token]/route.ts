export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, scanFiles, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq } from "drizzle-orm";

interface DownloadToken {
  licenceId: string;
  fileId: string;
  licenseeId: string;
  expiresAt: number;
}

// GET /api/download/[token] — validate a dual-custody download token and stream the file
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  const tokenData = await kv.get(`dl_token:${token}`, "json") as DownloadToken | null;
  if (!tokenData) {
    return NextResponse.json({ error: "Invalid or expired download link" }, { status: 404 });
  }
  if (tokenData.expiresAt < now) {
    return NextResponse.json({ error: "Download link has expired" }, { status: 410 });
  }
  if (tokenData.licenseeId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();

  // Check licence hasn't been revoked since token was issued
  const [licence] = await db
    .select({ status: licences.status })
    .from(licences)
    .where(eq(licences.id, tokenData.licenceId))
    .limit(1)
    .all();

  if (!licence || licence.status === "REVOKED") {
    return NextResponse.json({ error: "Licence has been revoked" }, { status: 410 });
  }

  // Fetch file metadata
  const [file] = await db
    .select({ filename: scanFiles.filename, r2Key: scanFiles.r2Key, contentType: scanFiles.contentType })
    .from(scanFiles)
    .where(eq(scanFiles.id, tokenData.fileId))
    .limit(1)
    .all();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { env } = getRequestContext();
  const object = await env.SCANS_BUCKET.get(file.r2Key);
  if (!object) {
    return NextResponse.json({ error: "File not in storage" }, { status: 404 });
  }

  // Mark download event as completed
  await db
    .update(downloadEvents)
    .set({ completedAt: now, bytesTransferred: object.size ?? null })
    .where(eq(downloadEvents.fileId, tokenData.fileId));

  const headers = new Headers();
  headers.set("Content-Type", file.contentType ?? "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${file.filename}"`);
  if (object.size) headers.set("Content-Length", String(object.size));
  // Prevent caching of sensitive files
  headers.set("Cache-Control", "no-store");

  return new NextResponse(object.body, { headers });
}
