export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isOrgType, type OrgType } from "@/lib/organisations/orgTypes";
import { eq } from "drizzle-orm";

// PATCH /api/admin/organisations/[id] — update org subtype and/or the vendor audit gate (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { orgType?: string; vendorAuditPassed?: boolean };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: { orgType?: OrgType; vendorAuditPassed?: boolean; updatedAt: number } = {
    updatedAt: Math.floor(Date.now() / 1000),
  };

  if (body.orgType !== undefined) {
    if (!isOrgType(body.orgType)) {
      return NextResponse.json({ error: "invalid orgType" }, { status: 400 });
    }
    updates.orgType = body.orgType;
  }

  if (body.vendorAuditPassed !== undefined) {
    if (typeof body.vendorAuditPassed !== "boolean") {
      return NextResponse.json({ error: "vendorAuditPassed must be a boolean" }, { status: 400 });
    }
    updates.vendorAuditPassed = body.vendorAuditPassed;
  }

  if (updates.orgType === undefined && updates.vendorAuditPassed === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const db = getDb();

  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, id))
    .limit(1)
    .all();
  if (!org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, id));

  return NextResponse.json({ ok: true });
}
