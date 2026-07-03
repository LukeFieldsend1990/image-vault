import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";
import { isIndustryRole } from "@/lib/auth/roles";
import { promoteCastMember, loadProductionDefaultTerms, type CastLicenceTerms } from "@/lib/productions/cast";
import { normaliseUseCategoryIds } from "@/lib/consent/use-categories";

// POST /api/productions/[id]/cast/[castId]/resolve
// Attach an email to a placeholder cast member and onboard them (invite or
// linked licence). Auth: admin, or licensee org owner/admin (no org → allowed).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  // Auth: admin, or licensee org owner/admin (mirrors POST /cast).
  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, production.organisationId),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  let body: {
    email?: string;
    intendedUse?: string;
    validFrom?: number;
    validTo?: number;
    licenceType?: string;
    territory?: string;
    exclusivity?: string;
    permitAiTraining?: boolean;
    useCategoryIds?: unknown;
    proposedFee?: number;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.email !== "string" || !body.email.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Only forward supplied fields as overrides; the rest come from the stored terms.
  const overrides: CastLicenceTerms = {};
  if (typeof body.intendedUse === "string") overrides.intendedUse = body.intendedUse;
  if (typeof body.validFrom === "number") overrides.validFrom = body.validFrom;
  if (typeof body.validTo === "number") overrides.validTo = body.validTo;
  if (typeof body.licenceType === "string") overrides.licenceType = body.licenceType as CastLicenceTerms["licenceType"];
  if (typeof body.territory === "string") overrides.territory = body.territory;
  if (typeof body.exclusivity === "string") overrides.exclusivity = body.exclusivity as CastLicenceTerms["exclusivity"];
  if (typeof body.permitAiTraining === "boolean") overrides.permitAiTraining = body.permitAiTraining;
  if (Array.isArray(body.useCategoryIds)) overrides.useCategoryIds = normaliseUseCategoryIds(body.useCategoryIds);
  if (typeof body.proposedFee === "number") overrides.proposedFee = body.proposedFee;

  const actor = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  // Production-level default terms act as the lowest-precedence fallback so a
  // placeholder with no stored terms can still resolve from the wizard's defaults.
  const defaults = await loadProductionDefaultTerms(db, id);

  const result = await promoteCastMember(db, {
    productionId: id,
    castId,
    email: body.email,
    actorUserId: session.sub,
    actorEmail: actor?.email ?? session.email,
    baseUrl,
    overrides,
    defaults,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    status: result.status,
    licenceId: result.licenceId,
    inviteId: result.inviteId,
  });
}
