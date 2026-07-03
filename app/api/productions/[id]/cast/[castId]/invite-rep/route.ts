import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { inviteRepForCast } from "@/lib/productions/rep";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/[castId]/invite-rep
// Assign a reserved placeholder slot to a representing agent — either an existing
// rep (`repUserId`) or a free-text `email` (→ rep signup invite). Path C.
// Industry org owner/admin or admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, production.organisationId),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  let body: { repUserId?: unknown; email?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const repUserId = typeof body.repUserId === "string" ? body.repUserId : undefined;
  const email = typeof body.email === "string" ? body.email : undefined;
  if (!repUserId && !email) {
    return NextResponse.json({ error: "Provide a repUserId or an email" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  const result = await inviteRepForCast(db, {
    productionId: id,
    castId,
    actorUserId: session.sub,
    actorEmail: session.email,
    baseUrl,
    repUserId,
    email,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true, mode: result.mode });
}
