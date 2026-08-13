import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentAccountWhitelist, monitorAccounts } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { and, eq } from "drizzle-orm";

const REASONS = new Set(["false_positive", "fan_fluff", "talent_approved", "other"]);

// POST /api/monitor/accounts/:id/whitelist — stop surfacing hits from this
// account for the current talent. Body: { reason, notes? }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can whitelist" }, { status: 403 });
  }

  const { id: accountId } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string; notes?: string };

  if (!body.reason || !REASONS.has(body.reason)) {
    return NextResponse.json(
      { error: "reason must be one of false_positive | fan_fluff | talent_approved | other" },
      { status: 400 }
    );
  }
  if (body.reason === "other" && !body.notes?.trim()) {
    return NextResponse.json({ error: "notes required when reason is 'other'" }, { status: 400 });
  }

  const db = getDb();
  const account = await db
    .select({ id: monitorAccounts.id })
    .from(monitorAccounts)
    .where(eq(monitorAccounts.id, accountId))
    .get();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  // ON CONFLICT is the honest behaviour: whitelisting the same account
  // again just updates the reason and timestamp rather than creating a
  // second row. UNIQUE(talent_id, account_id) enforces this.
  await db
    .insert(talentAccountWhitelist)
    .values({
      id,
      talentId: session.sub,
      accountId,
      reason: body.reason as "false_positive" | "fan_fluff" | "talent_approved" | "other",
      notes: body.notes?.trim() ? body.notes.trim().slice(0, 500) : null,
      addedBy: session.sub,
      addedAt: now,
    })
    .onConflictDoUpdate({
      target: [talentAccountWhitelist.talentId, talentAccountWhitelist.accountId],
      set: {
        reason: body.reason as "false_positive" | "fan_fluff" | "talent_approved" | "other",
        notes: body.notes?.trim() ? body.notes.trim().slice(0, 500) : null,
        addedBy: session.sub,
        addedAt: now,
      },
    });

  return NextResponse.json({ ok: true });
}

// DELETE /api/monitor/accounts/:id/whitelist — remove from the whitelist so
// hits from this account start surfacing again.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can whitelist" }, { status: 403 });
  }

  const { id: accountId } = await params;
  const db = getDb();
  await db
    .delete(talentAccountWhitelist)
    .where(
      and(
        eq(talentAccountWhitelist.talentId, session.sub),
        eq(talentAccountWhitelist.accountId, accountId)
      )
    );

  return NextResponse.json({ ok: true });
}
