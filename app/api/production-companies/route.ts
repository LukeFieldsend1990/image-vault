export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCompanies } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { like, desc } from "drizzle-orm";

// GET /api/production-companies?q=search — autocomplete search
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    const rows = await db
      .select({ id: productionCompanies.id, name: productionCompanies.name, website: productionCompanies.website })
      .from(productionCompanies)
      .orderBy(desc(productionCompanies.createdAt))
      .limit(10)
      .all();
    return NextResponse.json({ companies: rows });
  }

  const rows = await db
    .select({ id: productionCompanies.id, name: productionCompanies.name, website: productionCompanies.website })
    .from(productionCompanies)
    .where(like(productionCompanies.name, `%${q}%`))
    .orderBy(desc(productionCompanies.createdAt))
    .limit(10)
    .all();

  return NextResponse.json({ companies: rows });
}

// POST /api/production-companies — create a company
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { name?: string; website?: string; notes?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Check for existing (case-insensitive)
  const existing = await db
    .select({ id: productionCompanies.id })
    .from(productionCompanies)
    .where(like(productionCompanies.name, body.name.trim()))
    .limit(1)
    .all();

  if (existing.length > 0) {
    return NextResponse.json({ id: existing[0].id, existing: true });
  }

  const id = crypto.randomUUID();
  await db.insert(productionCompanies).values({
    id,
    name: body.name.trim(),
    website: body.website ?? null,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ id }, { status: 201 });
}
