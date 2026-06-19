import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { complianceGrants, productions } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getInsurerProductionGrants } from "@/lib/compliance/grants";
import { buildPortfolio } from "@/lib/compliance/underwriting";
import type { RegimeId } from "@/lib/compliance/types";
import { and, eq, isNull } from "drizzle-orm";

// GET /api/insurer/productions
// Portfolio roll-up for the calling insurer: one underwriting row per production
// they hold an insurer grant on. Strictly scoped to the caller's grants — never
// platform-wide. Admins see every production that has any insurer grant (preview).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isComplianceRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";

  let productionIds: string[];
  if (isComplianceRole(session.role)) {
    productionIds = (await getInsurerProductionGrants(db, session.sub)).map((g) => g.productionId);
  } else {
    // Admin preview: distinct productions with an active insurer grant.
    const rows = await db
      .select({ scopeId: complianceGrants.scopeId })
      .from(complianceGrants)
      .where(
        and(
          eq(complianceGrants.subtype, "insurer"),
          eq(complianceGrants.scope, "production"),
          isNull(complianceGrants.revokedAt),
        ),
      )
      .all();
    productionIds = [...new Set(rows.map((r) => r.scopeId).filter((id): id is string => !!id))];
  }

  // Drop ids whose production no longer exists.
  if (productionIds.length) {
    const existing = await db
      .select({ id: productions.id })
      .from(productions)
      .all();
    const set = new Set(existing.map((p) => p.id));
    productionIds = productionIds.filter((id) => set.has(id));
  }

  const portfolio = await buildPortfolio(db, productionIds, regime);
  return NextResponse.json({ productions: portfolio });
}
