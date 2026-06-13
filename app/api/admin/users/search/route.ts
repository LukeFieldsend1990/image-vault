export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { like, eq, and } from "drizzle-orm";

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

  const conditions = [like(users.email, `%${email}%`)];
  if (role) conditions.push(eq(users.role, role as "talent" | "rep" | "industry" | "licensee" | "compliance" | "admin"));

  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(and(...conditions))
    .limit(10)
    .all();

  return NextResponse.json({ users: rows });
}
