import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCast, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { promoteCastMember, loadProductionDefaultTerms, type CastLicenceTerms } from "@/lib/productions/cast";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/[castId]/rep-resolve
// The agent assigned to a reserved slot (Path C) supplies their client's email,
// resolving the placeholder. The *producer* who reserved the slot remains the
// licensee — the rep is the conduit. Auth: the assigned rep, or admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const production = await db
    .select({ id: productions.id })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const cast = await db
    .select({ id: productionCast.id, repId: productionCast.repId, status: productionCast.status, addedBy: productionCast.addedBy })
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!cast) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });

  // Auth: the assigned rep (or admin).
  if (!isAdmin(session.email) && cast.repId !== session.sub) {
    return NextResponse.json({ error: "Forbidden — this role is not assigned to you" }, { status: 403 });
  }
  if (cast.status !== "placeholder") {
    return NextResponse.json({ error: `This role is already "${cast.status}".` }, { status: 409 });
  }

  let body: { email?: string } & Partial<CastLicenceTerms>;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.email !== "string" || !body.email.trim()) {
    return NextResponse.json({ error: "Your client's email is required" }, { status: 400 });
  }

  // The producer who reserved the slot is the licensee on the resulting licence.
  const producer = await db.select({ email: users.email }).from(users).where(eq(users.id, cast.addedBy)).get();

  const overrides: CastLicenceTerms = {};
  if (typeof body.intendedUse === "string") overrides.intendedUse = body.intendedUse;
  if (typeof body.validFrom === "number") overrides.validFrom = body.validFrom;
  if (typeof body.validTo === "number") overrides.validTo = body.validTo;

  const defaults = await loadProductionDefaultTerms(db, id);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";

  const result = await promoteCastMember(db, {
    productionId: id,
    castId,
    email: body.email,
    actorUserId: cast.addedBy,
    actorEmail: producer?.email ?? "the production company",
    baseUrl,
    overrides,
    defaults,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true, status: result.status });
}
