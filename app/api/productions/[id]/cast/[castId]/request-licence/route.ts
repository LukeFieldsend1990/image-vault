import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions, productionCast, organisations, organisationMembers, users, licences,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { mintLicenceCode } from "@/lib/codes/codes";
import { loadProductionDefaultTerms, type CastLicenceTerms } from "@/lib/productions/cast";
import { reconcileTrainingFlag, serializeUseCategoryIds } from "@/lib/consent/use-categories";
import { loadStandingInstructions } from "@/lib/consent/standing-instructions";
import { resolveRequest } from "@/lib/consent/resolve";
import { acceptConsentForLicence } from "@/lib/consent/acceptance";
import { notifyTalentAndReps } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { productionCastLinkedEmail } from "@/lib/email/templates";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/[castId]/request-licence
// Create an AWAITING_PACKAGE licence for a cast row that has a linked talent but
// no licence yet — the producer-side follow-up to a Path D self-claim. Terms
// come from the production defaults, overridable per request. Industry org
// owner/admin or admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; castId: string }> }
) {
  const { id, castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, name: productions.name, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  // Auth: admin, or industry org owner/admin.
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

  const row = await db
    .select({ id: productionCast.id, talentId: productionCast.talentId, licenceId: productionCast.licenceId, characterName: productionCast.characterName })
    .from(productionCast)
    .where(and(eq(productionCast.id, castId), eq(productionCast.productionId, id)))
    .get();
  if (!row) return NextResponse.json({ error: "Cast member not found" }, { status: 404 });
  if (!row.talentId) return NextResponse.json({ error: "This role has no linked talent yet" }, { status: 409 });
  // Re-request is allowed when the existing licence is terminal (declined/revoked/
  // expired) — a producer can re-engage after a decline. An active licence blocks it.
  if (row.licenceId) {
    const existing = await db.select({ status: licences.status }).from(licences).where(eq(licences.id, row.licenceId)).get();
    const terminal = existing && ["DENIED", "REVOKED", "EXPIRED"].includes(existing.status);
    if (!terminal) return NextResponse.json({ error: "This role already has an active licence" }, { status: 409 });
  }

  // Terms: production defaults, overridable by the request body.
  let body: Partial<CastLicenceTerms> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const defaults = await loadProductionDefaultTerms(db, id);
  const intendedUse = (body.intendedUse ?? defaults.intendedUse ?? "").trim();
  const now = Math.floor(Date.now() / 1000);
  const validFrom = body.validFrom ?? defaults.validFrom ?? now;
  const validTo = body.validTo ?? defaults.validTo ?? now + 365 * 24 * 60 * 60;
  if (!intendedUse) {
    return NextResponse.json({ error: "Set production default terms (intended use) before sending licence requests." }, { status: 400 });
  }

  const org = production.organisationId
    ? await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, production.organisationId)).get()
    : null;
  const companyName = org?.name ?? "Production Company";

  const licenceType = (body.licenceType ?? defaults.licenceType ?? null) as typeof licences.$inferInsert["licenceType"];
  const territory = body.territory ?? defaults.territory ?? null;
  const exclusivity = (body.exclusivity ?? defaults.exclusivity ?? "non_exclusive") as typeof licences.$inferInsert["exclusivity"];
  // Reconcile the use-category taxonomy with the legacy permitAiTraining boolean.
  const reconciled = reconcileTrainingFlag({
    useCategoryIds: body.useCategoryIds ?? defaults.useCategoryIds,
    permitAiTraining: body.permitAiTraining ?? defaults.permitAiTraining ?? false,
  });
  const permitAiTraining = reconciled.permitAiTraining;
  const useCategoriesJson = serializeUseCategoryIds(reconciled.useCategoryIds);
  const proposedFee = body.proposedFee ?? defaults.proposedFee ?? null;

  const licenceId = crypto.randomUUID();
  await db.insert(licences).values({
    id: licenceId,
    talentId: row.talentId,
    licenseeId: session.sub,
    projectName: production.name,
    productionCompany: companyName,
    intendedUse,
    validFrom,
    validTo,
    status: "AWAITING_PACKAGE",
    licenceType,
    territory,
    exclusivity,
    permitAiTraining,
    useCategoriesJson,
    proposedFee,
    productionId: id,
    createdAt: now,
  });
  await mintLicenceCode(db, licenceId);

  // Point the cast row at the new licence and clear any prior `declined` state.
  await db.update(productionCast).set({ licenceId, status: "linked" }).where(eq(productionCast.id, castId));

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
  const reviewUrl = `${baseUrl}/licences/${licenceId}`;
  const talent = await db.select({ email: users.email }).from(users).where(eq(users.id, row.talentId)).get();

  // Standing-instruction auto-routing: if the performer has unanimous always/never
  // rules for every requested use, resolve the request immediately without them.
  const instructions = await loadStandingInstructions(db, row.talentId);
  const resolution = resolveRequest(reconciled.useCategoryIds, instructions);

  if (resolution.auto && resolution.action === "granted") {
    await acceptConsentForLicence(db, {
      licenceId,
      talentId: row.talentId,
      actorId: row.talentId, // authorised by the performer's standing instruction
      acceptedByEmail: talent?.email ?? "",
      acceptedByRole: "talent",
      uses: reconciled.useCategoryIds,
    });
    void notifyTalentAndReps(db, row.talentId, {
      type: "consent_auto_granted",
      title: `Consent auto-granted for ${production.name}`,
      body: resolution.reason,
      href: `/licences/${licenceId}`,
    });
    return NextResponse.json({ ok: true, licenceId, resolution: "auto_granted", reason: resolution.reason }, { status: 201 });
  }

  if (resolution.auto && resolution.action === "refused") {
    await db.update(licences).set({ status: "DENIED" }).where(eq(licences.id, licenceId));
    await db.update(productionCast).set({ status: "declined" }).where(eq(productionCast.id, castId));
    void notifyTalentAndReps(db, row.talentId, {
      type: "consent_auto_refused",
      title: `Request auto-declined for ${production.name}`,
      body: resolution.reason,
      href: `/licences/${licenceId}`,
    });
    return NextResponse.json({ ok: true, licenceId, resolution: "auto_refused", reason: resolution.reason }, { status: 201 });
  }

  // No auto-resolution — route to the performer (and their agent) for a decision.
  void notifyTalentAndReps(db, row.talentId, {
    type: "licence_request",
    title: `Licence request from ${production.name}`,
    body: `${companyName} sent you a licence request for ${production.name}.`,
    href: `/consent/${licenceId}`,
  });
  void (async () => {
    if (!talent?.email) return;
    const { subject, html } = productionCastLinkedEmail({
      recipientEmail: talent.email,
      productionName: production.name,
      companyName,
      coordinatorEmail: session.email,
      characterName: row.characterName ?? undefined,
      intendedUse,
      proposedFee: proposedFee ?? undefined,
      reviewUrl,
    });
    await sendEmail({ to: talent.email, subject, html }).catch(() => {});
  })();

  return NextResponse.json({ ok: true, licenceId, resolution: "pending" }, { status: 201 });
}
