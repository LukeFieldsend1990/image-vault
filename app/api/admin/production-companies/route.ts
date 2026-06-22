import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { resolveCompanyOrg } from "@/lib/organisations/resolveCompany";
import { eq } from "drizzle-orm";

// POST /api/admin/production-companies — "+ New Company" on the Productions
// screen. Production companies are organisations now, so this creates (or
// reuses) the unified organisation entity and a linked catalogue shim.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const { organisationId, productionCompanyId } = await resolveCompanyOrg(db, {
    name,
    createdBy: session.sub,
  });

  const website = typeof body.website === "string" && body.website.trim() ? body.website.trim() : null;
  if (website) {
    await db.update(organisations).set({ website, updatedAt: now }).where(eq(organisations.id, organisationId));
  }

  // `id` stays the catalogue id for backward-compatible callers; organisationId
  // is the canonical entity the UI links to.
  return NextResponse.json({ id: productionCompanyId, organisationId });
}
