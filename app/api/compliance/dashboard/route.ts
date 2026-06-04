export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { organisationMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { buildOrgDashboard } from "@/lib/compliance/dashboard";
import { isAdmin } from "@/lib/auth/adminEmails";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/compliance/dashboard?orgId=&regime=sag_aftra
//
// Returns the full org-level compliance dashboard payload.
// Licensees auto-resolve their org from membership; admins can pass ?orgId= explicitly.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const sp = new URL(req.url).searchParams;
  const regime = (sp.get("regime") as RegimeId) ?? "sag_aftra";
  const db = getDb();
  const adminUser = session.role === "admin" || isAdmin(session.email);

  let orgId = sp.get("orgId") ?? "";

  if (!orgId) {
    // Infer from session user's org membership
    const member = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(eq(organisationMembers.userId, session.sub))
      .get();
    if (!member) {
      return NextResponse.json(
        { error: "No organisation found for this account. Ask an admin to add you to an organisation." },
        { status: 404 },
      );
    }
    orgId = member.organisationId;
  }

  // Non-admins must be members of the requested org
  if (!adminUser) {
    const member = await db
      .select({ organisationId: organisationMembers.organisationId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.userId, session.sub),
          eq(organisationMembers.organisationId, orgId),
        ),
      )
      .get();
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const data = await buildOrgDashboard(db, orgId, regime);
  if (!data) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  return NextResponse.json(data);
}
