import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionInclusionRecords } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

// POST /api/admin/inclusions/[id]/review — acknowledge a flagged inclusion claim.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { note?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = {};
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const db = getDb();
  await db
    .update(productionInclusionRecords)
    .set({ reviewedAt: Math.floor(Date.now() / 1000), reviewedBy: session.sub, reviewNote: note || null })
    .where(eq(productionInclusionRecords.id, id));

  return NextResponse.json({ ok: true });
}
