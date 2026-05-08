export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles, packageTags } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, eq, isNull } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { todayKey } from "./shared";
import type { CloneRunRecord, ClonePackageItem, FileToCopy } from "./shared";
export type { CloneRunRecord, ClonePackageItem, FileToCopy } from "./shared";

// DELETE /api/admin/clone-packages — clears today's rate-limit record, allowing a same-day retry.
export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const kv = getRequestContext().env.SESSIONS_KV;
  await kv.delete(todayKey());
  return NextResponse.json({ ok: true });
}

// GET /api/admin/clone-packages
// Returns today's completed run record.
// Pass ?sourceEmail=X to also get the list of non-deleted packages on that account.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kv = getRequestContext().env.SESSIONS_KV;
  const raw = await kv.get(todayKey());
  const record: CloneRunRecord | null = raw ? (JSON.parse(raw) as CloneRunRecord) : null;

  const sourceEmail = new URL(req.url).searchParams.get("sourceEmail");
  if (sourceEmail) {
    const db = getDb();
    const sourceUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, sourceEmail))
      .get();

    if (!sourceUser) {
      return NextResponse.json({ error: "Source user not found" }, { status: 404 });
    }

    const packages: ClonePackageItem[] = await db
      .select({ id: scanPackages.id, name: scanPackages.name })
      .from(scanPackages)
      .where(and(eq(scanPackages.talentId, sourceUser.id), isNull(scanPackages.deletedAt)))
      .all();

    return NextResponse.json({ record, packages });
  }

  return NextResponse.json({ record });
}

// POST /api/admin/clone-packages
// Prepares a single package clone: creates the package + pending file records + tags in DB,
// then returns the list of R2 copy tasks for the client to process file-by-file.
// No R2 operations happen here, so this always completes well within the 30s Worker limit.
// Body: { sourceEmail, targetEmail, packageId }
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { sourceEmail?: string; targetEmail?: string; packageId?: string };
  try {
    body = (await req.json()) as { sourceEmail?: string; targetEmail?: string; packageId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceEmail, targetEmail, packageId } = body;
  if (!sourceEmail || !targetEmail || !packageId) {
    return NextResponse.json({ error: "sourceEmail, targetEmail, and packageId are required" }, { status: 400 });
  }

  const db = getDb();

  const sourceUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, sourceEmail))
    .get();
  if (!sourceUser) return NextResponse.json({ error: "Source user not found" }, { status: 404 });

  const targetUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, targetEmail))
    .get();
  if (!targetUser) return NextResponse.json({ error: "Target user not found" }, { status: 404 });

  const pkg = await db
    .select()
    .from(scanPackages)
    .where(and(eq(scanPackages.id, packageId), eq(scanPackages.talentId, sourceUser.id), isNull(scanPackages.deletedAt)))
    .get();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Dedup: skip if target already has a non-deleted package with this name
  const dupe = await db
    .select({ id: scanPackages.id })
    .from(scanPackages)
    .where(and(eq(scanPackages.talentId, targetUser.id), eq(scanPackages.name, pkg.name), isNull(scanPackages.deletedAt)))
    .get();
  if (dupe) {
    return NextResponse.json({ skipped: true, reason: "Package with this name already exists on target" });
  }

  const now = Math.floor(Date.now() / 1000);
  const newPkgId = crypto.randomUUID();

  // Only prepare copy tasks for completed files
  const sourceFileRows = await db
    .select()
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, pkg.id), eq(scanFiles.uploadStatus, "complete")))
    .all();

  // Build key mapping — collect all file rows first, then batch-insert in one statement
  const filesToCopy: FileToCopy[] = [];
  const keyMap = new Map<string, string>(); // sourceR2Key → destR2Key
  const newFileRows: (typeof scanFiles.$inferInsert)[] = [];

  for (const f of sourceFileRows) {
    const newFileId = crypto.randomUUID();
    const filename = f.r2Key.split("/").pop() ?? f.filename;
    const newR2Key = `scans/${targetUser.id}/${newPkgId}/${newFileId}/${filename}`;

    keyMap.set(f.r2Key, newR2Key);
    filesToCopy.push({ fileId: newFileId, sourceKey: f.r2Key, destKey: newR2Key });
    newFileRows.push({
      id: newFileId,
      packageId: newPkgId,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
      r2Key: newR2Key,
      contentType: f.contentType ?? null,
      uploadStatus: "pending",
      sha256: f.sha256 ?? null,
      createdAt: now,
      completedAt: null,
    });
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
    status: "uploading", // will become "ready" once all files are copied
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

  // Batch-insert all file records in one statement
  if (newFileRows.length > 0) {
    await db.insert(scanFiles).values(newFileRows);
  }

  // Copy tags — batch insert
  const sourceTagRows = await db
    .select()
    .from(packageTags)
    .where(eq(packageTags.packageId, pkg.id))
    .all();

  if (sourceTagRows.length > 0) {
    await db.insert(packageTags).values(
      sourceTagRows.map((t) => ({
        id: crypto.randomUUID(),
        packageId: newPkgId,
        tag: t.tag,
        category: t.category,
        status: t.status,
        suggestedBy: t.suggestedBy,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
      })),
    );
  }

  return NextResponse.json({
    skipped: false,
    newPackageId: newPkgId,
    filesToCopy,
    tags: sourceTagRows.length,
  });
}
