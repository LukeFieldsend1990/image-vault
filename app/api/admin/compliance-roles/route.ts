import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { buildComplianceRolesOverview } from "@/lib/compliance/compliance-roles";

// GET /api/admin/compliance-roles — aggregate for the compliance-roles console:
// union presets, insurer grants + policies, and the active watcher roster.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const overview = await buildComplianceRolesOverview(db);
  return NextResponse.json(overview);
}
