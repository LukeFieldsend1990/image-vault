import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { feeObligations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq } from "drizzle-orm";

const VALID = ["pending", "paid", "waived", "cancelled"] as const;

// PATCH /api/admin/fee-obligations/[id] — update status (mark paid / waived / cancelled)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { status?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.status || !(VALID as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const status = body.status as (typeof VALID)[number];

  const existing = await db.select({ id: feeObligations.id }).from(feeObligations).where(eq(feeObligations.id, id)).get();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .update(feeObligations)
    .set({ status, paidAt: status === "paid" ? now : null })
    .where(eq(feeObligations.id, id));

  return NextResponse.json({ ok: true });
}
