export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, count } from "drizzle-orm";

// GET /api/productions/[id] — get production detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select({
      id: productions.id,
      name: productions.name,
      companyId: productions.companyId,
      companyName: productionCompanies.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      imdbId: productions.imdbId,
      tmdbId: productions.tmdbId,
      director: productions.director,
      vfxSupervisor: productions.vfxSupervisor,
      notes: productions.notes,
      createdAt: productions.createdAt,
      updatedAt: productions.updatedAt,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .where(eq(productions.id, id))
    .limit(1)
    .all();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Count linked licences
  const [licenceCount] = await db
    .select({ count: count() })
    .from(licences)
    .where(eq(licences.productionId, id))
    .all();

  return NextResponse.json({ production: { ...row, licenceCount: licenceCount?.count ?? 0 } });
}

// PATCH /api/productions/[id] — update production metadata
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "admin" && session.role !== "rep") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const updates: Record<string, unknown> = { updatedAt: now };
  const allowedFields = ["name", "companyId", "type", "year", "status", "imdbId", "tmdbId", "director", "vfxSupervisor", "notes"];
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  await db.update(productions).set(updates).where(eq(productions.id, id));

  return NextResponse.json({ ok: true });
}
