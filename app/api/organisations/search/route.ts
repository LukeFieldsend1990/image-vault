import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { organisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { VENDOR_ORG_TYPES } from "@/lib/organisations/orgTypes";
import { like, and, inArray, type SQL } from "drizzle-orm";

// GET /api/organisations/search?q=&vendor=1 — look up orgs to authorise as vendors
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isIndustryRole(session.role) && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const vendorOnly = url.searchParams.get("vendor") === "1";
  if (q.length < 2) return NextResponse.json({ organisations: [] });

  const db = getDb();
  const filters: SQL[] = [like(organisations.name, `%${q}%`)];
  if (vendorOnly) filters.push(inArray(organisations.orgType, [...VENDOR_ORG_TYPES]));

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      orgType: organisations.orgType,
      shortCode: organisations.shortCode,
      vendorAuditPassed: organisations.vendorAuditPassed,
    })
    .from(organisations)
    .where(and(...filters))
    .limit(10)
    .all();

  return NextResponse.json({ organisations: rows });
}
