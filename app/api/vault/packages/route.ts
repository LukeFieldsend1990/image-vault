export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, packageTags } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, desc, sql, and, isNull, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // Reps can pass ?for=talentId to view a managed talent's packages
  const forTalentId = req.nextUrl.searchParams.get("for");
  let ownerId = session.sub;

  if (forTalentId) {
    if (session.role !== "rep" && session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (session.role === "rep" && !(await hasRepAccess(session.sub, forTalentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    ownerId = forTalentId;
  }

  const db = getDb();

  const packages = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      technicianNotes: scanPackages.technicianNotes,
      totalSizeBytes: scanPackages.totalSizeBytes,
      status: scanPackages.status,
      coverImageKey: scanPackages.coverImageKey,
      createdAt: scanPackages.createdAt,
      updatedAt: scanPackages.updatedAt,
      fileCount: sql<number>`count(${scanFiles.id})`.as("file_count"),
      scanType: scanPackages.scanType,
      tags: scanPackages.tags,
      hasMesh: scanPackages.hasMesh,
      hasTexture: scanPackages.hasTexture,
      hasHdr: scanPackages.hasHdr,
      hasMotionCapture: scanPackages.hasMotionCapture,
      compatibleEngines: scanPackages.compatibleEngines,
    })
    .from(scanPackages)
    .leftJoin(scanFiles, eq(scanFiles.packageId, scanPackages.id))
    .where(and(eq(scanPackages.talentId, ownerId), isNull(scanPackages.deletedAt)))
    .groupBy(scanPackages.id)
    .orderBy(desc(scanPackages.createdAt))
    .all();

  // Fetch structured AI tags for all returned packages
  const packageIds = packages.map((p) => p.id);
  const aiTags =
    packageIds.length > 0
      ? await db
          .select({
            packageId: packageTags.packageId,
            tag: packageTags.tag,
            category: packageTags.category,
            status: packageTags.status,
          })
          .from(packageTags)
          .where(inArray(packageTags.packageId, packageIds))
          .all()
      : [];

  const tagsByPackage = new Map<string, typeof aiTags>();
  for (const t of aiTags) {
    const arr = tagsByPackage.get(t.packageId) ?? [];
    arr.push(t);
    tagsByPackage.set(t.packageId, arr);
  }

  const enriched = packages.map((p) => ({
    ...p,
    aiTags: tagsByPackage.get(p.id) ?? [],
  }));

  return NextResponse.json({ packages: enriched });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    name?: string;
    description?: string;
    captureDate?: number;
    studioName?: string;
    technicianNotes?: string;
    forTalentId?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Reps can create packages on behalf of managed talent
  let ownerId = session.sub;
  if (body.forTalentId) {
    if (session.role !== "rep" && session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (session.role === "rep" && !(await hasRepAccess(session.sub, body.forTalentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    ownerId = body.forTalentId;
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const packageId = crypto.randomUUID();

  await db.insert(scanPackages).values({
    id: packageId,
    talentId: ownerId,
    name: body.name.trim(),
    description: body.description ?? null,
    captureDate: body.captureDate ?? null,
    studioName: body.studioName ?? null,
    technicianNotes: body.technicianNotes ?? null,
    totalSizeBytes: null,
    status: "uploading",
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ packageId }, { status: 201 });
}
