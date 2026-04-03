export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCompanies, productions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc } from "drizzle-orm";

// GET /api/production-companies/[id] — get company detail with linked productions
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const [company] = await db
    .select()
    .from(productionCompanies)
    .where(eq(productionCompanies.id, id))
    .limit(1)
    .all();

  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const prods = await db
    .select({ id: productions.id, name: productions.name, type: productions.type, year: productions.year })
    .from(productions)
    .where(eq(productions.companyId, id))
    .orderBy(desc(productions.createdAt))
    .all();

  return NextResponse.json({ company, productions: prods });
}

// PATCH /api/production-companies/[id] — update company
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
  for (const field of ["name", "website", "notes"]) {
    if (field in body) updates[field] = body[field];
  }

  await db.update(productionCompanies).set(updates).where(eq(productionCompanies.id, id));

  return NextResponse.json({ ok: true });
}
