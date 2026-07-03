import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions, productionCompanies, organisations, productionDefaultTerms, invites, users,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { mintProductionCode, mintOrgCode } from "@/lib/codes/codes";
import { importTmdbPlaceholders } from "@/lib/productions/tmdb-cast";
import { CAST_EXCLUSIVITIES } from "@/lib/productions/cast";
import { reconcileTrainingFlag, serializeUseCategoryIds } from "@/lib/consent/use-categories";
import { conciergeProductionInviteEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { eq } from "drizzle-orm";

const PRODUCTION_TYPES = ["film", "tv_series", "tv_movie", "commercial", "game", "music_video", "other"] as const;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

// POST /api/admin/productions/concierge
// Admin-only: pre-build a production (org + production + TMDB cast + default
// terms) and invite an industry user who becomes the org owner on signup,
// arriving to a mostly-set-up production. Mirrors the guided wizard, admin-driven.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    companyName?: unknown;
    inviteeEmail?: unknown;
    production?: {
      name?: unknown; type?: unknown; year?: unknown; tmdbId?: unknown;
      sagProjectNumber?: unknown; isSag?: unknown; isEquity?: unknown; otherUnion?: unknown;
    };
    importCast?: unknown;
    defaultTerms?: {
      intendedUse?: unknown; territory?: unknown;
      exclusivity?: unknown; permitAiTraining?: unknown; useCategoryIds?: unknown;
      isRelicense?: unknown; validFrom?: unknown; validTo?: unknown; proposedFee?: unknown;
    };
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const inviteeEmail = typeof body.inviteeEmail === "string" ? body.inviteeEmail.toLowerCase().trim() : "";
  const prod = body.production ?? {};
  const prodName = typeof prod.name === "string" ? prod.name.trim() : "";

  if (!companyName) return NextResponse.json({ error: "Company name is required" }, { status: 400 });
  if (!inviteeEmail || !inviteeEmail.includes("@")) return NextResponse.json({ error: "A valid invitee email is required" }, { status: 400 });
  if (!prodName) return NextResponse.json({ error: "Production name is required" }, { status: 400 });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // The invitee must not already exist (they sign up via the invite to claim ownership).
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, inviteeEmail)).get();
  if (existing) {
    return NextResponse.json({ error: "That email already has an account. Attach them to a production directly instead." }, { status: 409 });
  }

  const type = typeof prod.type === "string" && (PRODUCTION_TYPES as readonly string[]).includes(prod.type) ? prod.type : "film";
  const year = typeof prod.year === "number" ? Math.floor(prod.year) : null;
  const tmdbId = typeof prod.tmdbId === "number" ? Math.floor(prod.tmdbId) : null;
  const sagProjectNumber = typeof prod.sagProjectNumber === "string" && prod.sagProjectNumber.trim() ? prod.sagProjectNumber.trim() : null;
  const isSag = prod.isSag === true;
  const isEquity = prod.isEquity === true;
  const otherUnion = typeof prod.otherUnion === "string" && prod.otherUnion.trim() ? prod.otherUnion.trim() : null;

  // 1. Production company + org (owner assigned to the invitee on signup).
  const companyId = crypto.randomUUID();
  await db.insert(productionCompanies).values({ id: companyId, name: companyName, createdAt: now, updatedAt: now });

  const orgId = crypto.randomUUID();
  await db.insert(organisations).values({
    id: orgId,
    name: companyName,
    productionCompanyId: companyId,
    createdBy: session.sub,
    createdAt: now,
    updatedAt: now,
    orgType: "production_company",
  });
  await mintOrgCode(db, orgId, "production_company");

  // 2. Production.
  const productionId = crypto.randomUUID();
  await db.insert(productions).values({
    id: productionId,
    name: prodName,
    companyId,
    type: type as typeof productions.$inferInsert["type"],
    year,
    status: "pre_production",
    tmdbId,
    sagProjectNumber,
    isSag,
    isEquity,
    otherUnion,
    organisationId: orgId,
    createdAt: now,
    updatedAt: now,
  });
  await mintProductionCode(db, productionId);

  // 3. Cast — bulk-import TMDB placeholders if requested + linked.
  let castCount = 0;
  if (body.importCast === true && tmdbId) {
    const res = await importTmdbPlaceholders(db, {
      productionId,
      production: { type, tmdbId },
      addedBy: session.sub,
    });
    if (!("error" in res)) castCount = res.imported;
  }

  // 4. Default terms (optional). Mirrors PUT /api/productions/[id]/default-terms:
  // use-category taxonomy is the consent-aligned access selector; reconcile with
  // the legacy permitAiTraining flag so the two can't drift.
  const dt = body.defaultTerms;
  if (dt) {
    const intendedUse = typeof dt.intendedUse === "string" && dt.intendedUse.trim() ? dt.intendedUse.trim() : null;
    const territory = typeof dt.territory === "string" && dt.territory.trim() ? dt.territory.trim() : null;
    const exclusivity = typeof dt.exclusivity === "string" && (CAST_EXCLUSIVITIES as readonly string[]).includes(dt.exclusivity) ? dt.exclusivity : null;
    const reconciled = reconcileTrainingFlag({
      useCategoryIds: Array.isArray(dt.useCategoryIds) ? (dt.useCategoryIds as unknown[]).filter((v): v is string => typeof v === "string") : null,
      permitAiTraining: dt.permitAiTraining === true,
    });
    const useCategoriesJson = serializeUseCategoryIds(reconciled.useCategoryIds);
    const permitAiTraining = reconciled.permitAiTraining;
    const isRelicense = typeof dt.isRelicense === "boolean" ? dt.isRelicense : null;
    const validFrom = typeof dt.validFrom === "number" ? Math.floor(dt.validFrom) : null;
    const validTo = typeof dt.validTo === "number" ? Math.floor(dt.validTo) : null;
    const proposedFee = typeof dt.proposedFee === "number" ? Math.floor(dt.proposedFee) : null;
    if (validFrom !== null && validTo !== null && validTo <= validFrom) {
      return NextResponse.json({ error: "validTo must be after validFrom" }, { status: 400 });
    }
    if (intendedUse || useCategoriesJson || territory || validFrom || validTo || proposedFee !== null || isRelicense !== null) {
      await db.insert(productionDefaultTerms).values({
        productionId,
        intendedUse,
        licenceType: null,
        territory,
        exclusivity,
        permitAiTraining,
        useCategoriesJson,
        isRelicense,
        validFrom,
        validTo,
        proposedFee,
        updatedBy: session.sub,
        updatedAt: now,
      });
    }
  }

  // 5. Invite — industry user becomes org owner + production coordinator on signup.
  const inviteId = crypto.randomUUID();
  await db.insert(invites).values({
    id: inviteId,
    email: inviteeEmail,
    role: "industry",
    invitedBy: session.sub,
    talentId: null,
    message: `Your production ${prodName} has been set up on Image Vault.`,
    usedAt: null,
    expiresAt: now + SEVEN_DAYS,
    createdAt: now,
    productionId,
    organisationId: orgId,
    orgSubtype: "production_company",
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
  void (async () => {
    const { subject, html } = conciergeProductionInviteEmail({
      recipientEmail: inviteeEmail,
      productionName: prodName,
      companyName,
      castCount,
      signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
    });
    await sendEmail({ to: inviteeEmail, subject, html });
  })();

  return NextResponse.json({ ok: true, productionId, organisationId: orgId, inviteId, castCount }, { status: 201 });
}
