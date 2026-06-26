import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions,
  productionCountries,
  organisationMembers,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";

async function authorise(req: NextRequest, productionId: string) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { ok: false as const, response: session };

  const db = getDb();
  const row = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!row) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  if (isAdmin(session.email)) {
    return { ok: true as const, sub: session.sub };
  }
  if (!isIndustryRole(session.role)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!row.organisationId) {
    return { ok: true as const, sub: session.sub };
  }
  const membership = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, row.organisationId),
        eq(organisationMembers.userId, session.sub)
      )
    )
    .get();
  if (!membership) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, sub: session.sub };
}

// DELETE /api/productions/[id]/countries/[countryId] — soft-remove a country
// from scope. Home country cannot be removed (compliance ground truth — change
// home through a different flow if it ever becomes necessary).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; countryId: string }> }
) {
  const { id, countryId } = await params;
  const auth = await authorise(req, id);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const row = await db
    .select()
    .from(productionCountries)
    .where(and(eq(productionCountries.id, countryId), eq(productionCountries.productionId, id)))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.isHome) return NextResponse.json({ error: "Cannot remove the home country" }, { status: 400 });
  if (row.status === "removed") return NextResponse.json({ ok: true });

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(productionCountries)
    .set({ status: "removed", removedAt: now, removedBy: auth.sub })
    .where(eq(productionCountries.id, countryId));

  return NextResponse.json({ ok: true });
}
