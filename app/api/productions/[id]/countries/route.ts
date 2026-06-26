import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions,
  productionCountries,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { topLevelById } from "@/lib/jurisdictions/countries";
import { eq, and, asc } from "drizzle-orm";

// Authorise the caller on the production. `requireWrite` distinguishes reads
// (any team member) from mutations (org owner/admin or production editor).
// Returns the production row on success, a NextResponse on failure.
async function authorise(
  req: NextRequest,
  productionId: string,
  requireWrite: boolean
): Promise<
  | { ok: true; productionRow: { id: string; organisationId: string | null }; sub: string }
  | { ok: false; response: NextResponse }
> {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { ok: false, response: session };

  const db = getDb();
  const row = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  if (isAdmin(session.email)) {
    return { ok: true, productionRow: row, sub: session.sub };
  }

  if (!isIndustryRole(session.role)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const access = await resolveOwnerAccess(db, productionId, row.organisationId, session.sub);
  if (!access.isMember || (requireWrite && !access.canWrite)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, productionRow: row, sub: session.sub };
}

// GET /api/productions/[id]/countries — list every country in scope for this
// production, plus any soft-removed ones. The home country sits first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorise(req, id, false);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const rows = await db
    .select()
    .from(productionCountries)
    .where(eq(productionCountries.productionId, id))
    .orderBy(asc(productionCountries.addedAt))
    .all();

  // Sort home first, then in_scope by added_at asc, then removed at the end.
  rows.sort((a, b) => {
    if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
    if (a.status !== b.status) return a.status === "in_scope" ? -1 : 1;
    return a.addedAt - b.addedAt;
  });

  return NextResponse.json({ countries: rows });
}

// POST /api/productions/[id]/countries — add a country to scope. Body:
// { name: string, topLevelId: 'UK'|'EU'|'US'|... }. Refuses duplicates that are
// still in scope; if a previously removed row exists, it's reactivated.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorise(req, id, true);
  if (!auth.ok) return auth.response;

  let body: { name?: string; topLevelId?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim();
  const topLevelId = body.topLevelId?.trim();
  if (!name || !topLevelId || !topLevelById(topLevelId)) {
    return NextResponse.json({ error: "name and topLevelId are required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = await db
    .select()
    .from(productionCountries)
    .where(and(eq(productionCountries.productionId, id), eq(productionCountries.name, name)))
    .get();

  if (existing) {
    if (existing.status === "in_scope") {
      return NextResponse.json({ error: "Country already in scope" }, { status: 409 });
    }
    // Reactivate a soft-removed row rather than inserting a new one — keeps
    // the audit chain pointed at one logical record per (production, country).
    await db
      .update(productionCountries)
      .set({ status: "in_scope", addedAt: now, addedBy: auth.sub, removedAt: null, removedBy: null })
      .where(eq(productionCountries.id, existing.id));
    return NextResponse.json({ id: existing.id }, { status: 200 });
  }

  const countryId = crypto.randomUUID();
  await db.insert(productionCountries).values({
    id: countryId,
    productionId: id,
    name,
    topLevelId,
    isHome: false,
    status: "in_scope",
    addedAt: now,
    addedBy: auth.sub,
  });

  return NextResponse.json({ id: countryId }, { status: 201 });
}
