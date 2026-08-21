import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { trialAllowances, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/admin/scout/allowances
 * Body: { email, extraRuns } — grant (or reset) extra trial runs for one
 * rep/production account on top of the global default. extraRuns is the new
 * absolute grant, not an increment, so a mis-grant is fixed by re-submitting.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as { email?: string; extraRuns?: number };
  const email = body.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!Number.isInteger(body.extraRuns) || (body.extraRuns as number) < 0 || (body.extraRuns as number) > 100) {
    return NextResponse.json({ error: "extraRuns must be a whole number between 0 and 100" }, { status: 400 });
  }

  const db = getDb();
  const user = await db
    .select({ id: users.id, role: sql<string>`COALESCE(${users.trueRole}, ${users.role})` })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!user) return NextResponse.json({ error: "No account with that email" }, { status: 404 });
  if (!isScoutRole(user.role)) {
    return NextResponse.json(
      { error: "Trial runs only apply to rep and production accounts" },
      { status: 400 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ userId: trialAllowances.userId })
    .from(trialAllowances)
    .where(eq(trialAllowances.userId, user.id))
    .get();
  if (existing) {
    await db
      .update(trialAllowances)
      .set({ extraRuns: body.extraRuns as number, grantedBy: session.sub, updatedAt: now })
      .where(eq(trialAllowances.userId, user.id));
  } else {
    await db.insert(trialAllowances).values({
      userId: user.id,
      extraRuns: body.extraRuns as number,
      grantedBy: session.sub,
      updatedAt: now,
    });
  }

  return NextResponse.json({ ok: true, userId: user.id });
}
