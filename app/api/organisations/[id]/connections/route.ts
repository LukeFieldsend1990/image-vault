import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { listOrgConnections } from "@/lib/organisations/connections";
import { and, eq } from "drizzle-orm";

// GET /api/organisations/[id]/connections — visibility connections this org is a
// party to, rendered from the org's perspective with least-privilege applied.
// Members only (admins may view).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  if (!isAdmin(session.email)) {
    const membership = await db
      .select({ memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, id), eq(organisationMembers.userId, session.sub)))
      .get();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connections = await listOrgConnections(db, id);
  return NextResponse.json({ connections });
}
