import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisations } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { attachVendor, listProductionVendors } from "@/lib/productions/vendors";
import { eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

// Authorise the caller to view/manage this production's vendors. Returns the
// loaded production or a short-circuit response.
async function authorize(
  db: Db,
  session: { sub: string; email: string; role: string },
  productionId: string,
  requireWrite: boolean,
) {
  const production = await db
    .select({ id: productions.id, name: productions.name, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();
  if (!production) return { error: NextResponse.json({ error: "Production not found" }, { status: 404 }) };

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const access = await resolveOwnerAccess(db, productionId, production.organisationId, session.sub);
    if (!access.isMember) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    if (requireWrite && !access.canWrite) {
      return { error: NextResponse.json({ error: "Forbidden — operational access required" }, { status: 403 }) };
    }
  }
  return { production };
}

// GET /api/productions/[id]/vendors — attached + pending vendors.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorize(db, session, id, false);
  if ("error" in auth) return auth.error;

  const vendors = await listProductionVendors(db, id);
  return NextResponse.json({ vendors });
}

// POST /api/productions/[id]/vendors
//   { vendorOrgId }                         → attach an existing vendor org
//   { email, orgName, vendorType }          → invite a new vendor by email
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorize(db, session, id, true);
  if ("error" in auth) return auth.error;
  const { production } = auth;

  let body: { vendorOrgId?: unknown; email?: unknown; orgName?: unknown; vendorType?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const org = production.organisationId
    ? await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, production.organisationId)).get()
    : null;
  const companyName = org?.name ?? "A production company";

  const result = await attachVendor(db, {
    productionId: id,
    productionName: production.name,
    companyName,
    actorUserId: session.sub,
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io",
    vendorOrgId: typeof body.vendorOrgId === "string" ? body.vendorOrgId : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    orgName: typeof body.orgName === "string" ? body.orgName : undefined,
    vendorType: typeof body.vendorType === "string" ? body.vendorType : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
  return NextResponse.json({ ok: true, mode: result.mode }, { status: 201 });
}
