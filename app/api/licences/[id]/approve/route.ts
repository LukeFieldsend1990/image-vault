export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";

// POST /api/licences/[id]/approve — talent/rep approves a pending licence request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent" && session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [licence] = await db
    .select({ id: licences.id, talentId: licences.talentId, status: licences.status })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (licence.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "PENDING") {
    return NextResponse.json({ error: "Licence is not in PENDING state" }, { status: 409 });
  }

  await db
    .update(licences)
    .set({ status: "APPROVED", approvedBy: session.sub, approvedAt: now })
    .where(eq(licences.id, id));

  return NextResponse.json({ ok: true });
}
