import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions,
  productionCast,
  organisations,
  organisationMembers,
  users,
  invites,
  licences,
  talentProfiles,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { getRepAgencyContext } from "@/lib/agency/rep-visibility";
import { mintLicenceCode } from "@/lib/codes/codes";
import { normaliseLicenceTypes, serializeLicenceTypes } from "@/lib/productions/cast";
import {
  normaliseUseCategoryIds,
  serializeUseCategoryIds,
  reconcileTrainingFlag,
  type UseCategoryId,
} from "@/lib/consent/use-categories";
import { eq, and, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import {
  productionCastInviteEmail,
  productionCastLinkedEmail,
} from "@/lib/email/templates";

// GET /api/productions/[id]/cast
// List cast rows with talent details, invite status, licence status.
// Auth: licensee org member of the production's org, OR admin.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Load production
  const production = await db
    .select({
      id: productions.id,
      name: productions.name,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) {
    return NextResponse.json({ error: "Production not found" }, { status: 404 });
  }

  // Auth check: admin, licensee org member, or rep with an assigned cast slot
  // (rep-scoped view) or agency-shared visibility (full production cast).
  let repScopedView = false;
  if (!isAdmin(session.email)) {
    if (session.role === "rep") {
      // Reps with agency-shared visibility on this production see the full
      // cast; otherwise they only see slots assigned directly to them.
      const ctx = await getRepAgencyContext(db, session.sub);
      if (!ctx.agencyProductionIds.includes(id)) {
        repScopedView = true;
      }
    } else if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const castRows = await db
    .select()
    .from(productionCast)
    .where(
      repScopedView
        ? and(eq(productionCast.productionId, id), eq(productionCast.repId, session.sub))
        : eq(productionCast.productionId, id)
    )
    .all();

  // Enrich with talent profile, invite/licence, and rep info
  const talentIds = castRows
    .map((r) => r.talentId)
    .filter((t): t is string => t !== null);

  const inviteIds = castRows
    .map((r) => r.inviteId)
    .filter((t): t is string => t !== null);

  const licenceIds = castRows
    .map((r) => r.licenceId)
    .filter((t): t is string => t !== null);

  const repUserIds = castRows
    .map((r) => r.repId)
    .filter((t): t is string => t !== null);

  const repInviteIds = castRows
    .map((r) => r.repInviteId)
    .filter((t): t is string => t !== null);

  const [profiles, inviteRows, licenceRows, repUsers, repInviteRows] = await Promise.all([
    talentIds.length > 0
      ? db
          .select({
            userId: talentProfiles.userId,
            fullName: talentProfiles.fullName,
            profileImageUrl: talentProfiles.profileImageUrl,
          })
          .from(talentProfiles)
          .where(inArray(talentProfiles.userId, talentIds))
          .all()
      : Promise.resolve([]),
    inviteIds.length > 0
      ? db
          .select({
            id: invites.id,
            email: invites.email,
            usedAt: invites.usedAt,
            expiresAt: invites.expiresAt,
          })
          .from(invites)
          .where(inArray(invites.id, inviteIds))
          .all()
      : Promise.resolve([]),
    licenceIds.length > 0
      ? db
          .select({
            id: licences.id,
            status: licences.status,
            projectName: licences.projectName,
          })
          .from(licences)
          .where(inArray(licences.id, licenceIds))
          .all()
      : Promise.resolve([]),
    repUserIds.length > 0
      ? db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, repUserIds))
          .all()
      : Promise.resolve([]),
    repInviteIds.length > 0
      ? db
          .select({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt, usedAt: invites.usedAt })
          .from(invites)
          .where(inArray(invites.id, repInviteIds))
          .all()
      : Promise.resolve([]),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const inviteMap = new Map(inviteRows.map((i) => [i.id, i]));
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));
  const repUserMap = new Map(repUsers.map((u) => [u.id, u]));
  const repInviteMap = new Map(repInviteRows.map((i) => [i.id, i]));

  const enriched = castRows.map((row) => ({
    ...row,
    talentProfile: row.talentId ? profileMap.get(row.talentId) ?? null : null,
    invite: row.inviteId ? inviteMap.get(row.inviteId) ?? null : null,
    licence: row.licenceId ? licenceMap.get(row.licenceId) ?? null : null,
    repEmail: row.repId ? (repUserMap.get(row.repId)?.email ?? null) : null,
    repInvite: row.repInviteId
      ? (() => {
          const ri = repInviteMap.get(row.repInviteId);
          return ri ? { email: ri.email, expiresAt: ri.expiresAt, accepted: ri.usedAt !== null } : null;
        })()
      : null,
    // omit licence terms from list response
    licenceTermsJson: undefined,
  }));

  const castTotal = castRows.length;
  const consentedCount = castRows.filter((r) => r.status === "consented").length;
  const invitedCount = castRows.filter((r) => r.status === "invited").length;

  return NextResponse.json({ cast: enriched, castTotal, consentedCount, invitedCount });
}

interface CastMemberInput {
  email?: string;       // contactable member — onboarded now
  actorName?: string;   // placeholder — recorded by name only, resolve later
  tmdbId?: number;
  sourceNote?: string;
  characterName?: string;
  /** @deprecated cast department is no longer captured (item 1); column retained for a later cleanup migration. */
  department?: string;
  sagMember?: boolean;
  unionAffiliation?: string;
  intendedUse?: string;
  validFrom?: number;
  validTo?: number;
  licenceType?: string;          // legacy primary use type
  licenceTypes?: string[];       // multi-select use types (item 7)
  useCategoryIds?: UseCategoryId[]; // canonical consent scope (§39 taxonomy)
  territory?: string;
  exclusivity?: string;
  permitAiTraining?: boolean;
  proposedFee?: number | null;   // null = N/A (distinct from 0); item 9
  isRelicense?: boolean;         // item 9
}

// POST /api/productions/[id]/cast
// Bulk add cast members. Creates licences or invites as appropriate.
// Auth: licensee org owner/admin or admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Load production with company name
  const production = await db
    .select({
      id: productions.id,
      name: productions.name,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) {
    return NextResponse.json({ error: "Production not found" }, { status: 404 });
  }

  // Auth check: admin or licensee org owner/admin
  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  let body: { members?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.members) || body.members.length === 0) {
    return NextResponse.json({ error: "members array is required" }, { status: 400 });
  }

  // Validate each member
  const members: CastMemberInput[] = [];
  for (const m of body.members) {
    if (typeof m !== "object" || m === null) {
      return NextResponse.json({ error: "Each member must be an object" }, { status: 400 });
    }
    const member = m as Record<string, unknown>;
    const email = typeof member.email === "string" ? member.email.toLowerCase().trim() : "";
    const actorName = typeof member.actorName === "string" ? member.actorName.trim() : "";
    // Union affiliation drives the SAG flag. Prefer the explicit union string sent
    // by the UI; fall back to the legacy sagMember boolean from older callers.
    const unionAffiliation =
      typeof member.unionAffiliation === "string" && member.unionAffiliation.trim()
        ? member.unionAffiliation.trim()
        : typeof member.sagMember === "boolean" && member.sagMember
          ? "SAG-AFTRA"
          : undefined;
    const sagMember = unionAffiliation
      ? unionAffiliation === "SAG-AFTRA"
      : typeof member.sagMember === "boolean"
        ? member.sagMember
        : false;
    if (!email && !actorName) {
      return NextResponse.json({ error: "each member needs an email or an actorName" }, { status: 400 });
    }
    // Contactable members are onboarded immediately, so full terms are required.
    // Placeholders (actorName only) carry whatever terms are known, no email sent.
    if (email) {
      if (typeof member.intendedUse !== "string" || !member.intendedUse) {
        return NextResponse.json({ error: "intendedUse is required for contactable members" }, { status: 400 });
      }
      if (typeof member.validFrom !== "number" || typeof member.validTo !== "number") {
        return NextResponse.json({ error: "validFrom and validTo are required for contactable members" }, { status: 400 });
      }
    }
    members.push({
      email: email || undefined,
      actorName: actorName || undefined,
      tmdbId: typeof member.tmdbId === "number" ? Math.floor(member.tmdbId) : undefined,
      sourceNote: typeof member.sourceNote === "string" ? member.sourceNote : undefined,
      characterName: typeof member.characterName === "string" ? member.characterName : undefined,
      // department deprecated (item 1) — intentionally not read from the client payload.
      sagMember,
      unionAffiliation,
      intendedUse: typeof member.intendedUse === "string" ? member.intendedUse : undefined,
      validFrom: typeof member.validFrom === "number" ? member.validFrom : undefined,
      validTo: typeof member.validTo === "number" ? member.validTo : undefined,
      licenceTypes: normaliseLicenceTypes(member.licenceTypes),
      licenceType: typeof member.licenceType === "string" ? member.licenceType : undefined,
      territory: typeof member.territory === "string" ? member.territory : undefined,
      exclusivity: typeof member.exclusivity === "string" ? member.exclusivity : undefined,
      // Consent scope (§39 taxonomy) reconciled with the legacy permitAiTraining
      // boolean so picking `training` implies AI-training permitted, and vice versa.
      ...(() => {
        const { useCategoryIds, permitAiTraining } = reconcileTrainingFlag({
          useCategoryIds: normaliseUseCategoryIds(member.useCategoryIds),
          permitAiTraining: typeof member.permitAiTraining === "boolean" ? member.permitAiTraining : false,
        });
        return { useCategoryIds, permitAiTraining };
      })(),
      // null is a deliberate "N/A" signal (item 9); only a real number is a fee.
      proposedFee: typeof member.proposedFee === "number" ? member.proposedFee : (member.proposedFee === null ? null : undefined),
      isRelicense: typeof member.isRelicense === "boolean" ? member.isRelicense : undefined,
    });
  }

  // Get company name for emails
  const org = production.organisationId
    ? await db
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, production.organisationId))
        .get()
    : null;
  const companyName = org?.name ?? "Production Company";

  // Get coordinator email
  const coordinatorUser = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  const coordinatorEmail = coordinatorUser?.email ?? session.email;

  const now = Math.floor(Date.now() / 1000);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";

  let created = 0;
  let linked = 0;
  let invited = 0;
  let placeholders = 0;
  const errors: string[] = [];

  // Primary single use type (first of the multi-select array) for legacy readers.
  const primaryType = (member: CastMemberInput) =>
    (member.licenceTypes && member.licenceTypes.length ? member.licenceTypes[0] : member.licenceType) ?? null;

  // Stored licence-terms blob carried on a row until a licence is created.
  const termsBlob = (member: CastMemberInput) => ({
    intendedUse: member.intendedUse,
    validFrom: member.validFrom,
    validTo: member.validTo,
    licenceType: primaryType(member),
    licenceTypes: member.licenceTypes ?? [],
    useCategoryIds: member.useCategoryIds ?? [],
    territory: member.territory ?? null,
    exclusivity: member.exclusivity ?? "non_exclusive",
    permitAiTraining: member.permitAiTraining ?? false,
    proposedFee: member.proposedFee ?? null,
    isRelicense: member.isRelicense ?? false,
    projectName: production.name,
    productionCompany: companyName,
  });

  for (const member of members) {
    try {
      // Placeholder: recorded by name only, no email/invite yet.
      if (!member.email) {
        await db.insert(productionCast).values({
          id: crypto.randomUUID(),
          productionId: id,
          talentId: null,
          inviteId: null,
          licenceId: null,
          actorName: member.actorName ?? null,
          tmdbId: member.tmdbId ?? null,
          sourceNote: member.sourceNote ?? null,
          characterName: member.characterName ?? null,
          department: member.department ?? null,
          sagMember: member.sagMember ?? false,
          unionAffiliation: member.unionAffiliation ?? null,
          status: "placeholder",
          licenceTermsJson: JSON.stringify(termsBlob(member)),
          // Item 11 — unclaimed likeness: the production is the GDPR data controller
          // until the talent claims their vault (handover recorded on claim).
          dataControllerOrgId: production.organisationId ?? null,
          dataControllerSince: production.organisationId ? now : null,
          addedBy: session.sub,
          addedAt: now,
          linkedAt: null,
        });
        placeholders++;
        created++;
        continue;
      }

      // Contactable member — email + full terms validated above.
      const email = member.email;
      const intendedUse = member.intendedUse as string;
      const validFrom = member.validFrom as number;
      const validTo = member.validTo as number;

      // Look up user by email
      const existingUser = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (existingUser && existingUser.role === "talent") {
        // Talent exists — create cast row + licence
        const castId = crypto.randomUUID();
        const licenceId = crypto.randomUUID();

        await db.insert(licences).values({
          id: licenceId,
          talentId: existingUser.id,
          licenseeId: session.sub,
          projectName: production.name,
          productionCompany: companyName,
          intendedUse,
          validFrom,
          validTo,
          status: "AWAITING_PACKAGE",
          licenceType: (primaryType(member) as typeof licences.$inferInsert["licenceType"]) ?? null,
          licenceTypesJson: serializeLicenceTypes(member.licenceTypes),
          isRelicense: member.isRelicense ?? null,
          territory: member.territory ?? null,
          exclusivity: (member.exclusivity as typeof licences.$inferInsert["exclusivity"]) ?? "non_exclusive",
          permitAiTraining: member.permitAiTraining ?? false,
          useCategoriesJson: serializeUseCategoryIds(member.useCategoryIds),
          proposedFee: member.proposedFee ?? null,
          productionId: id,
          createdAt: now,
        });
        await mintLicenceCode(db, licenceId);

        await db.insert(productionCast).values({
          id: castId,
          productionId: id,
          talentId: existingUser.id,
          inviteId: null,
          licenceId,
          characterName: member.characterName ?? null,
          department: member.department ?? null,
          sagMember: member.sagMember ?? false,
          unionAffiliation: member.unionAffiliation ?? null,
          status: "linked",
          licenceTermsJson: null,
          addedBy: session.sub,
          addedAt: now,
          linkedAt: now,
        });

        // Fire-and-forget email to talent
        void (async () => {
          const { subject, html } = productionCastLinkedEmail({
            recipientEmail: email,
            productionName: production.name,
            companyName,
            coordinatorEmail,
            characterName: member.characterName,
            intendedUse,
            proposedFee: member.proposedFee ?? undefined,
            reviewUrl: `${baseUrl}/licences/${licenceId}`,
          });
          await sendEmail({ to: email, subject, html });
        })();

        linked++;
      } else {
        // Talent not in system — create invite + cast row with stored licence terms
        const inviteId = crypto.randomUUID();
        const expiresAt = now + 7 * 24 * 60 * 60; // 7 days

        const licenceTerms = {
          intendedUse,
          validFrom,
          validTo,
          licenceType: primaryType(member),
          licenceTypes: member.licenceTypes ?? [],
          useCategoryIds: member.useCategoryIds ?? [],
          territory: member.territory ?? null,
          exclusivity: member.exclusivity ?? "non_exclusive",
          permitAiTraining: member.permitAiTraining ?? false,
          proposedFee: member.proposedFee ?? null,
          isRelicense: member.isRelicense ?? false,
          projectName: production.name,
          productionCompany: companyName,
        };

        await db.insert(invites).values({
          id: inviteId,
          email,
          role: "talent",
          invitedBy: session.sub,
          talentId: null,
          message: `You've been invited to join the cast of ${production.name}.`,
          usedAt: null,
          expiresAt,
          createdAt: now,
          productionId: id,
        });

        const castId = crypto.randomUUID();
        await db.insert(productionCast).values({
          id: castId,
          productionId: id,
          talentId: null,
          inviteId,
          licenceId: null,
          characterName: member.characterName ?? null,
          department: member.department ?? null,
          sagMember: member.sagMember ?? false,
          unionAffiliation: member.unionAffiliation ?? null,
          status: "invited",
          licenceTermsJson: JSON.stringify(licenceTerms),
          // Item 11 — still unclaimed (no talentId): production is data controller.
          dataControllerOrgId: production.organisationId ?? null,
          dataControllerSince: production.organisationId ? now : null,
          addedBy: session.sub,
          addedAt: now,
          linkedAt: null,
        });

        // Fire-and-forget invite email
        void (async () => {
          const { subject, html } = productionCastInviteEmail({
            recipientEmail: email,
            productionName: production.name,
            companyName,
            coordinatorEmail,
            characterName: member.characterName,
            intendedUse,
            validFrom,
            validTo,
            signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
          });
          await sendEmail({ to: email, subject, html });
        })();

        invited++;
      }

      created++;
    } catch (err) {
      errors.push(`${member.email ?? member.actorName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ created, linked, invited, placeholders, errors }, { status: 201 });
}
