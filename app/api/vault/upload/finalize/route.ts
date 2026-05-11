export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, sql, and } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { sendEmail } from "@/lib/email/send";
import { uploadCompleteEmail } from "@/lib/email/templates";
import { triggerAiService } from "@/lib/ai/service";

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

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

  const pkg = await db
    .select({ id: scanPackages.id, name: scanPackages.name, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  const isOwner = pkg?.talentId === session.sub;
  const isRep =
    !!pkg && session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));

  if (!pkg || (!isOwner && !isRep)) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const [completedResult, failedResult, sizeResult, talentUser] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
      .get(),
    db.select({ count: sql<number>`count(*)` })
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "error")))
      .get(),
    db.select({ total: sql<number>`sum(size_bytes)` })
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
      .get(),
    db.select({ email: users.email }).from(users).where(eq(users.id, pkg.talentId)).get(),
  ]);

  const fileCount = completedResult?.count ?? 0;
  const failedCount = failedResult?.count ?? 0;
  const totalSizeBytes = sizeResult?.total ?? 0;

  if (talentUser?.email && fileCount > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = uploadCompleteEmail({
      talentEmail: talentUser.email,
      packageName: pkg.name,
      fileCount,
      failedCount,
      totalSizeBytes,
      vaultUrl: `${baseUrl}/dashboard`,
    });
    void sendEmail({ to: talentUser.email, subject, html });
  }

  const { ctx } = getRequestContext();
  ctx.waitUntil(
    triggerAiService(req, `/package-tags/auto/${packageId}`, {
      method: "POST",
      headers: { "x-ai-source": "upload-complete" },
    }).catch(() => {})
  );

  return NextResponse.json({ ok: true });
}
