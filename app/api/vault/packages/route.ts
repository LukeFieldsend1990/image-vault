export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

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
      createdAt: scanPackages.createdAt,
      updatedAt: scanPackages.updatedAt,
      fileCount: sql<number>`count(${scanFiles.id})`.as("file_count"),
    })
    .from(scanPackages)
    .leftJoin(scanFiles, eq(scanFiles.packageId, scanPackages.id))
    .where(eq(scanPackages.talentId, session.sub))
    .groupBy(scanPackages.id)
    .orderBy(desc(scanPackages.createdAt))
    .all();

  return NextResponse.json({ packages });
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
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const packageId = crypto.randomUUID();

  await db.insert(scanPackages).values({
    id: packageId,
    talentId: session.sub,
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
