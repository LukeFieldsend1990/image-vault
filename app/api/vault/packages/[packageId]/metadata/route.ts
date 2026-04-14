export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { triggerReindex } from "@/lib/search/reindex";
import { eq } from "drizzle-orm";

async function canAccessPackage(db: ReturnType<typeof getDb>, packageId: string, session: { sub: string; role: string }) {
  const [pkg] = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .limit(1)
    .all();

  if (!pkg) return null;

  if (session.role === "admin") return pkg;
  if (session.role === "talent" && pkg.talentId === session.sub) return pkg;
  if (session.role === "rep") {
    const [rep] = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(eq(talentReps.repId, session.sub))
      .all();
    if (rep) return pkg;
  }
  return null;
}

// GET /api/vault/packages/[packageId]/metadata
export async function GET(req: NextRequest, { params }: { params: Promise<{ packageId: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId: id } = await params;
  const db = getDb();
  const pkg = await canAccessPackage(db, id, session);
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      scanType: scanPackages.scanType,
      resolution: scanPackages.resolution,
      polygonCount: scanPackages.polygonCount,
      colorSpace: scanPackages.colorSpace,
      hasMesh: scanPackages.hasMesh,
      hasTexture: scanPackages.hasTexture,
      hasHdr: scanPackages.hasHdr,
      hasMotionCapture: scanPackages.hasMotionCapture,
      compatibleEngines: scanPackages.compatibleEngines,
      tags: scanPackages.tags,
      internalNotes: scanPackages.internalNotes,
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, id))
    .limit(1)
    .all();

  return NextResponse.json({ metadata: row });
}

// PATCH /api/vault/packages/[packageId]/metadata
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ packageId: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId: id } = await params;
  const db = getDb();
  const pkg = await canAccessPackage(db, id, session);
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const updates: Record<string, unknown> = { updatedAt: now };
  const allowedFields = [
    "scanType", "resolution", "polygonCount", "colorSpace",
    "hasMesh", "hasTexture", "hasHdr", "hasMotionCapture",
    "compatibleEngines", "tags", "internalNotes",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      // JSON fields need to be stringified
      if ((field === "compatibleEngines" || field === "tags") && Array.isArray(body[field])) {
        updates[field] = JSON.stringify(body[field]);
      } else {
        updates[field] = body[field];
      }
    }
  }

  await db.update(scanPackages).set(updates).where(eq(scanPackages.id, id));

  triggerReindex(id);

  return NextResponse.json({ ok: true });
}
