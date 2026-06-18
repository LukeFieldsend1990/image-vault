export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { like, eq, and, or, type SQL } from "drizzle-orm";

// GET /api/admin/users/search?email=xxx&role=licensee
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  const role = req.nextUrl.searchParams.get("role") ?? null;

  if (email.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const db = getDb();

  // Fuzzy match: every whitespace-separated token must appear somewhere in the
  // email (case-insensitive substring). Lets "luke equity" match
  // "lukefieldsend+equity@googlemail.com" without the exact address. Single-token
  // queries behave like a plain substring search.
  const tokens = email.split(/\s+/).filter(Boolean);
  const conditions: SQL[] = tokens.map((t) => like(users.email, `%${t}%`));

  // Match on the *effective* role. Industry/compliance accounts are stored with a
  // legacy users.role ("licensee") and their real role in users.true_role
  // (effective role = true_role ?? role), so filter on either column — otherwise
  // a role=compliance search never finds any compliance account.
  if (role) {
    const r = role as "talent" | "rep" | "industry" | "licensee" | "compliance" | "admin";
    conditions.push(or(eq(users.role, r), eq(users.trueRole, r))!);
  }

  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role, trueRole: users.trueRole })
    .from(users)
    .where(and(...conditions))
    .limit(10)
    .all();

  return NextResponse.json({
    users: rows.map((u) => ({ id: u.id, email: u.email, role: u.trueRole ?? u.role })),
  });
}
