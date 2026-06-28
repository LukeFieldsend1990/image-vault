import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { rslLicenseRequests } from "@/lib/db/schema";
import { grantRequest, denyRequest, storeDelivery } from "@/lib/rsl/olp";

/**
 * Decide an OLP licence request. The rights-holder (or their agent / an admin)
 * grants or denies. Granting mints a license token and stashes it for one-time
 * pickup by the polling client. This is the human-consent gate for amber
 * (permitted-with-terms) requests.
 *
 * Body: { action: "grant" | "deny" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  let body: { action?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action === "grant" || body.action === "deny" ? body.action : null;
  if (!action) return NextResponse.json({ error: "action (grant|deny) required" }, { status: 400 });

  const db = getDb();
  const row = await db.select().from(rslLicenseRequests).where(eq(rslLicenseRequests.id, id)).get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authorisation: the talent, their rep, or an admin may decide.
  const allowed =
    isAdmin(session.email) ||
    row.talentId === session.sub ||
    (session.role === "rep" && (await hasRepAccess(session.sub, row.talentId)));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (row.status !== "pending_review") {
    return NextResponse.json({ error: `Request already ${row.status}.` }, { status: 409 });
  }

  if (action === "deny") {
    await denyRequest(db, id, session.sub);
    return NextResponse.json({ ok: true, status: "denied" });
  }

  const grant = await grantRequest(db, id, session.sub);
  await storeDelivery(id, grant.rawToken); // client collects on its next poll
  return NextResponse.json({ ok: true, status: "granted", expires_at: grant.expiresAt });
}
