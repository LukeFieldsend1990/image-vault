import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { canonicalCode } from "@/lib/codes/codes";
import { eq, and, or, like } from "drizzle-orm";

// GET /api/reps?q=<query>
// Search existing representatives (agents/agencies) by email or system code
// (AG-####), for the Path C "invite their representation" picker. Industry or
// admin only.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email) && !isIndustryRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const db = getDb();

  // A code-shaped query (AG-####) resolves by system code as well as email.
  const code = canonicalCode(q);
  const match = code
    ? or(like(users.email, `%${q}%`), eq(users.shortCode, code))
    : like(users.email, `%${q}%`);

  const rows = await db
    .select({ id: users.id, email: users.email, shortCode: users.shortCode })
    .from(users)
    .where(q ? and(eq(users.role, "rep"), match) : eq(users.role, "rep"))
    .limit(10)
    .all();

  return NextResponse.json({ reps: rows });
}
