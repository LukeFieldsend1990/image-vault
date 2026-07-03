import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, productions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { markLicenceIncluded } from "@/lib/productions/inclusion";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { eq } from "drizzle-orm";

// POST /api/licences/[id]/mark-included
// Mark a licence as production-included ($0 fee, not a re-licence). Allowed for:
//   - platform admins
//   - the licensee who holds the licence
//   - any production member with write access (editor / owner)
// Never blocked — prior usage is recorded and flagged for admin review.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const licence = await db
    .select({ id: licences.id, licenseeId: licences.licenseeId, productionId: licences.productionId })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });

  if (!isAdmin(session.email) && licence.licenseeId !== session.sub) {
    // Also allow production members with write access.
    let productionWriteAccess = false;
    if (licence.productionId) {
      const prod = await db
        .select({ organisationId: productions.organisationId })
        .from(productions)
        .where(eq(productions.id, licence.productionId))
        .get();
      if (prod) {
        const access = await resolveOwnerAccess(db, licence.productionId, prod.organisationId, session.sub);
        productionWriteAccess = access.canWrite;
      }
    }
    if (!productionWriteAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let body: { reason?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = {};
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  try {
    const result = await markLicenceIncluded(db, { licenceId: id, markedByUserId: session.sub, reason, baseUrl });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
    return NextResponse.json({ ok: true, flagged: result.flagged, message: result.message });
  } catch (err) {
    console.error("[mark-included] unexpected error", err);
    return NextResponse.json({ error: "Internal error — could not mark as included." }, { status: 500 });
  }
}
