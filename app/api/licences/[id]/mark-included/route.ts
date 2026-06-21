import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { markLicenceIncluded } from "@/lib/productions/inclusion";
import { eq } from "drizzle-orm";

// POST /api/licences/[id]/mark-included
// Mark a licence as production-included (£0 fee, not a re-licence). Allowed for
// the licensee who holds the licence, or an admin. Never blocked — prior usage
// is recorded and flagged for admin review.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const licence = await db
    .select({ id: licences.id, licenseeId: licences.licenseeId })
    .from(licences)
    .where(eq(licences.id, id))
    .get();
  if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });

  if (!isAdmin(session.email) && licence.licenseeId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { reason?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = {};
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const result = await markLicenceIncluded(db, { licenceId: id, markedByUserId: session.sub, reason, baseUrl });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true, flagged: result.flagged, message: result.message });
}
