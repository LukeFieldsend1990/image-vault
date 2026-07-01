import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { rslLicenseRequests, licences, rslClients } from "@/lib/db/schema";
import { grantRequest, denyRequest, storeDelivery, usageEndpoint } from "@/lib/rsl/olp";
import { approveOlpLicence } from "@/lib/rsl/funnel";

/**
 * Decide an OLP licence request. The rights-holder (or their agent / an admin)
 * grants or denies. Granting APPROVES the linked licence (setting the fee +
 * 15% platform cut and minting a metered `rsk_` royalty key), mints the consent
 * token, and stashes the credential payload for one-time pickup by the polling
 * client. This is the human-consent gate for permitted-with-terms requests.
 *
 * Body: { action: "grant" | "deny", agreedUnitRatePence?: number }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  let body: { action?: unknown; agreedUnitRatePence?: unknown } = {};
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

  const open = ["pending_review", "offered", "accepted"];
  if (!open.includes(row.status)) {
    return NextResponse.json({ error: `Request already ${row.status}.` }, { status: 409 });
  }

  if (action === "deny") {
    await denyRequest(db, id, session.sub);
    return NextResponse.json({ ok: true, status: "denied" });
  }

  // Approve the linked licence + mint the metered royalty key.
  let royaltyKey: string | null = null;
  let unitType: string | null = null;
  let unitRateCents: number | null = null;
  if (row.licenceId) {
    const clientRow = await db
      .select({ id: rslClients.id })
      .from(rslClients)
      .innerJoin(licences, eq(licences.licenseeId, rslClients.licenseeId))
      .where(eq(licences.id, row.licenceId))
      .get();
    const agreedUnitRatePence =
      typeof body.agreedUnitRatePence === "number" && body.agreedUnitRatePence > 0
        ? Math.floor(body.agreedUnitRatePence)
        : null;
    const res = await approveOlpLicence(db, {
      licenceId: row.licenceId,
      approverId: session.sub,
      clientId: clientRow?.id ?? null,
      agreedUnitRatePence,
    });
    royaltyKey = res.royaltyKey;
    const lic = await db
      .select({ aut: licences.agreedUnitType, aur: licences.agreedUnitRatePence })
      .from(licences)
      .where(eq(licences.id, row.licenceId))
      .get();
    unitType = lic?.aut ?? null;
    unitRateCents = lic?.aur ?? null;
  }

  const grant = await grantRequest(db, id, session.sub);
  const delivery = {
    license: grant.rawToken,
    royalty_key: royaltyKey,
    usage_endpoint: royaltyKey ? usageEndpoint() : null,
    unit_type: unitType,
    unit_rate_cents: unitRateCents,
    expires_at: grant.expiresAt,
  };
  await storeDelivery(id, JSON.stringify(delivery)); // client collects on next poll

  return NextResponse.json({ ok: true, status: "granted", royaltyKeyIssued: !!royaltyKey, expires_at: grant.expiresAt });
}
