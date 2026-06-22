import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, organisations, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { mintProductionCode } from "@/lib/codes/codes";
import { resolveCompanyOrg } from "@/lib/organisations/resolveCompany";
import { eq, like, desc, and } from "drizzle-orm";

// GET /api/productions?q=search — autocomplete search
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    // Return recent productions when no query
    const rows = await db
      .select({
        id: productions.id,
        name: productions.name,
        companyId: productions.companyId,
        companyName: productionCompanies.name,
        type: productions.type,
        year: productions.year,
      })
      .from(productions)
      .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
      .orderBy(desc(productions.createdAt))
      .limit(10)
      .all();
    return NextResponse.json({ productions: rows });
  }

  const rows = await db
    .select({
      id: productions.id,
      name: productions.name,
      companyId: productions.companyId,
      companyName: productionCompanies.name,
      type: productions.type,
      year: productions.year,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .where(like(productions.name, `%${q}%`))
    .orderBy(desc(productions.createdAt))
    .limit(10)
    .all();

  return NextResponse.json({ productions: rows });
}

// POST /api/productions — create a production
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    name?: string;
    companyId?: string;
    companyName?: string;
    type?: string;
    year?: number;
    status?: string;
    imdbId?: string;
    tmdbId?: number;
    director?: string;
    vfxSupervisor?: string;
    notes?: string;
    organisationId?: string;
    sagProjectNumber?: string;
    isSag?: boolean;
    isEquity?: boolean;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Licensee role must supply an organisationId and be a member of it
  if (isIndustryRole(session.role) && !body.organisationId) {
    return NextResponse.json(
      { error: "Licensee users must provide an organisationId when creating a production" },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Validate organisationId if provided
  let orgId: string | null = null;
  if (body.organisationId) {
    const org = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, body.organisationId))
      .get();
    if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
    orgId = org.id;

    // If licensee, verify membership
    if (isIndustryRole(session.role)) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, orgId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership) {
        return NextResponse.json(
          { error: "You are not a member of this organisation" },
          { status: 403 }
        );
      }
    }
  }

  // Resolve the production company. A company name maps to the unified
  // organisation entity (creating + linking a catalogue shim as needed), so a
  // production attributed to a company always gets an organisationId too.
  let companyId = body.companyId ?? null;
  if (!companyId && body.companyName?.trim()) {
    const refs = await resolveCompanyOrg(db, { name: body.companyName.trim(), createdBy: session.sub });
    companyId = refs.productionCompanyId;
    if (!orgId) orgId = refs.organisationId;
  }

  const productionId = crypto.randomUUID();
  await db.insert(productions).values({
    id: productionId,
    name: body.name.trim(),
    companyId,
    type: (body.type as "film" | "tv_series" | "tv_movie" | "commercial" | "game" | "music_video" | "other" | undefined) ?? null,
    year: body.year ?? null,
    status: (body.status as "development" | "pre_production" | "production" | "post_production" | "released" | "cancelled" | undefined) ?? null,
    imdbId: body.imdbId ?? null,
    tmdbId: body.tmdbId ?? null,
    director: body.director ?? null,
    vfxSupervisor: body.vfxSupervisor ?? null,
    notes: body.notes ?? null,
    organisationId: orgId,
    coordinatorId: session.sub,
    sagProjectNumber: body.sagProjectNumber ?? null,
    isSag: body.isSag ?? false,
    isEquity: body.isEquity ?? false,
    createdAt: now,
    updatedAt: now,
  });

  await mintProductionCode(db, productionId);

  return NextResponse.json({ id: productionId, companyId }, { status: 201 });
}
