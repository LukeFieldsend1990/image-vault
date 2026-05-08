export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles, packageTags } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin, ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { sendEmail } from "@/lib/email/send";
import { clonePackagesEmail } from "@/lib/email/templates";
import { and, eq, isNull } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

export interface CloneRunRecord {
  runAt: number;
  triggeredBy: string;
  sourceEmail: string;
  targetEmail: string;
  summary: { packages: number; files: number; filesFailed: number; tags: number; failedFiles: string[] };
}

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

function todayKey(): string {
  return `clone_packages:daily:${new Date().toISOString().slice(0, 10)}`;
}

async function copyR2Object(
  r2: AwsClient,
  endpoint: string,
  bucket: string,
  sourceKey: string,
  destKey: string,
): Promise<boolean> {
  const url = `${endpoint}/${bucket}/${destKey}`;
  const signed = await r2.sign(
    new Request(url, {
      method: "PUT",
      headers: { "x-amz-copy-source": `/${bucket}/${encodeURIComponent(sourceKey)}` },
    }),
  );
  const res = await fetch(signed);
  return res.ok;
}

// GET /api/admin/clone-packages — returns today's run record (or null)
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kv = getRequestContext().env.SESSIONS_KV;
  const raw = await kv.get(todayKey());
  const record: CloneRunRecord | null = raw ? (JSON.parse(raw) as CloneRunRecord) : null;
  return NextResponse.json({ record });
}

// POST /api/admin/clone-packages
// Body: { sourceEmail: string; targetEmail: string }
// Rate-limited to 1 run per UTC calendar day. Sends admin email on completion.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Daily rate limit — one run per UTC day, global (not per-IP)
  const kv = getRequestContext().env.SESSIONS_KV;
  const existing = await kv.get(todayKey());
  if (existing) {
    const prev = JSON.parse(existing) as CloneRunRecord;
    return NextResponse.json(
      { error: "Already run today", record: prev },
      { status: 429 },
    );
  }

  let body: { sourceEmail?: string; targetEmail?: string };
  try {
    body = (await req.json()) as { sourceEmail?: string; targetEmail?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceEmail, targetEmail } = body;
  if (!sourceEmail || !targetEmail) {
    return NextResponse.json({ error: "sourceEmail and targetEmail required" }, { status: 400 });
  }

  const db = getDb();
  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucket = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";
  const r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  const sourceUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, sourceEmail))
    .get();
  if (!sourceUser) {
    return NextResponse.json({ error: "Source user not found" }, { status: 404 });
  }

  const targetUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, targetEmail))
    .get();
  if (!targetUser) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  const sourcePkgs = await db
    .select()
    .from(scanPackages)
    .where(and(eq(scanPackages.talentId, sourceUser.id), isNull(scanPackages.deletedAt)))
    .all();

  const now = Math.floor(Date.now() / 1000);
  const summary = {
    packages: 0,
    files: 0,
    filesFailed: 0,
    tags: 0,
    failedFiles: [] as string[],
  };

  for (const pkg of sourcePkgs) {
    const newPkgId = crypto.randomUUID();

    // Only copy completed files — pending/error have no usable R2 object
    const sourceFileRows = await db
      .select()
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, pkg.id), eq(scanFiles.uploadStatus, "complete")))
      .all();

    const keyMap = new Map<string, string>(); // oldR2Key → newR2Key
    const newFileRows: (typeof scanFiles.$inferInsert)[] = [];

    for (const f of sourceFileRows) {
      const newFileId = crypto.randomUUID();
      const filename = f.r2Key.split("/").pop() ?? f.filename;
      const newR2Key = `scans/${targetUser.id}/${newPkgId}/${newFileId}/${filename}`;

      const ok = await copyR2Object(r2, r2Endpoint, bucket, f.r2Key, newR2Key);
      if (!ok) {
        summary.filesFailed++;
        summary.failedFiles.push(f.r2Key);
        continue;
      }

      keyMap.set(f.r2Key, newR2Key);
      newFileRows.push({
        id: newFileId,
        packageId: newPkgId,
        filename: f.filename,
        sizeBytes: f.sizeBytes,
        r2Key: newR2Key,
        contentType: f.contentType,
        uploadStatus: "complete",
        sha256: f.sha256 ?? null,
        createdAt: now,
        completedAt: now,
      });
      summary.files++;
    }

    const newCoverKey = pkg.coverImageKey ? (keyMap.get(pkg.coverImageKey) ?? null) : null;

    await db.insert(scanPackages).values({
      id: newPkgId,
      talentId: targetUser.id,
      name: pkg.name,
      description: pkg.description ?? null,
      captureDate: pkg.captureDate ?? null,
      studioName: pkg.studioName ?? null,
      technicianNotes: pkg.technicianNotes ?? null,
      totalSizeBytes: pkg.totalSizeBytes ?? null,
      status: pkg.status,
      coverImageKey: newCoverKey,
      scanType: pkg.scanType ?? null,
      resolution: pkg.resolution ?? null,
      polygonCount: pkg.polygonCount ?? null,
      colorSpace: pkg.colorSpace ?? null,
      hasMesh: pkg.hasMesh ?? false,
      hasTexture: pkg.hasTexture ?? false,
      hasHdr: pkg.hasHdr ?? false,
      hasMotionCapture: pkg.hasMotionCapture ?? false,
      compatibleEngines: pkg.compatibleEngines ?? null,
      tags: pkg.tags ?? null,
      internalNotes: pkg.internalNotes ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBy: null,
      searchIndexedAt: null,
    });
    summary.packages++;

    for (const f of newFileRows) {
      await db.insert(scanFiles).values(f);
    }

    const sourceTagRows = await db
      .select()
      .from(packageTags)
      .where(eq(packageTags.packageId, pkg.id))
      .all();

    for (const t of sourceTagRows) {
      await db.insert(packageTags).values({
        id: crypto.randomUUID(),
        packageId: newPkgId,
        tag: t.tag,
        category: t.category,
        status: t.status,
        suggestedBy: t.suggestedBy,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
      });
      summary.tags++;
    }
  }

  // Record the run in KV — expires after 48h (well past midnight UTC)
  const record: CloneRunRecord = {
    runAt: now,
    triggeredBy: session.email,
    sourceEmail,
    targetEmail,
    summary,
  };
  await kv.put(todayKey(), JSON.stringify(record), { expirationTtl: 172800 });

  // Notify all admins
  void (async () => {
    const { subject, html } = clonePackagesEmail({
      triggeredBy: session.email,
      sourceEmail,
      targetEmail,
      ranAt: now,
      ...summary,
    });
    await sendEmail({ to: [...ADMIN_EMAILS], subject, html });
  })();

  return NextResponse.json({ ok: true, summary });
}
