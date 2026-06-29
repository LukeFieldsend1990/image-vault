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
  licenceNegotiations,
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
import { eq, and, inArray, asc } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { notifyTalentAndReps } from "@/lib/notifications/create";
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

  const [profiles, inviteRows, licenceRows, repUsers, repInviteRows, negoRows] = await Promise.all([
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
    licenceIds.length > 0
      ? db
          .select({ licenceId: licenceNegotiations.licenceId, round: licenceNegotiations.round, party: licenceNegotiations.party, action: licenceNegotiations.action })
          .from(licenceNegotiations)
          .where(inArray(licenceNegotiations.licenceId, licenceIds))
          .orderBy(asc(licenceNegotiations.round))
          .all()
      : Promise.resolve([]),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const inviteMap = new Map(inviteRows.map((i) => [i.id, i]));
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));
  const repUserMap = new Map(repUsers.map((u) => [u.id, u]));
  const repInviteMap = new Map(repInviteRows.map((i) => [i.id, i]));

  // Pending negotiation: a performer/agent counter-offer awaiting the producer's
  // agreement (latest round is an open talent/rep counter). Surfaced on the cast
  // list so the producer knows terms changed and need their sign-off. negoRows is
  // ordered by round ascending, so the last row seen per licence is the latest.
  const latestNegoByLicence = new Map<string, { party: string; action: string }>();
  for (const n of negoRows) {
    latestNegoByLicence.set(n.licenceId, { party: n.party, action: n.action });
  }
  const negoPendingByLicence = new Map<string, boolean>();
  for (const [lid, last] of latestNegoByLicence) {
    negoPendingByLicence.set(lid, last.action === "counter" && (last.party === "talent" || last.party === "rep"));
  }

  const enriched = castRows.map((row) => ({
    ...row,
    talentProfile: row.talentId ? profileMap.get(row.talentId) ?? null : null,
    // Privacy: never expose an invited talent's email to the cast list — a
    // production-held performer hasn't accepted, so we don't dox them. Only the
    // invite status (sent/used/expiry) is surfaced.
    invite: row.inviteId
      ? (() => {
          const i = inviteMap.get(row.inviteId!);
          return i ? { id: i.id, usedAt: i.usedAt, expiresAt: i.expiresAt } : null;
        })()
      : null,
    licence: row.licenceId ? licenceMap.get(row.licenceId) ?? null : null,
    negotiationPending: row.licenceId ? (negoPendingByLicence.get(row.licenceId) ?? false) : false,
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
  talentId?: string;    // existing Image Vault talent picked from the matcher (link by id, no email exposed)
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
    // talentId: an existing Image Vault talent picked from the matcher. Lets the
    // producer link by id without ever handling the performer's email.
    const talentId = typeof member.talentId === "string" && member.talentId.trim() ? member.talentId.trim() : "";
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
    if (!email && !actorName && !talentId) {
      return NextResponse.json({ error: "each member needs an email, a talentId, or an actorName" }, { status: 400 });
    }
    // Contactable members (email) and linked talent (talentId) are onboarded
    // immediately, so full terms are required. Placeholders (name only) carry
    // whatever terms are known, no email sent.
    if (email || talentId) {
      if (typeof member.intendedUse !== "string" || !member.intendedUse) {
        return NextResponse.json({ error: "intendedUse is required for contactable members" }, { status: 400 });
      }
      if (typeof member.validFrom !== "number" || typeof member.validTo !== "number") {
        return NextResponse.json({ error: "validFrom and validTo are required for contactable members" }, { status: 400 });
      }
    }
    members.push({
      email: email || undefined,
      talentId: talentId || undefined,
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
      // Placeholder: recorded by name only, no email/talentId/invite yet.
      if (!member.email && !member.talentId) {
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

      // Contactable member (email) or linked talent (talentId) — terms validated above.
      const intendedUse = member.intendedUse as string;
      const validFrom = member.validFrom as number;
      const validTo = member.validTo as number;

      // Resolve the talent — by explicit talentId (from the matcher; no email
      // exposed to the producer) or by email lookup. The server uses the talent's
      // own email only to notify them.
      const existingUser = member.talentId
        ? await db.select({ id: users.id, role: users.role, email: users.email }).from(users).where(eq(users.id, member.talentId)).get()
        : await db.select({ id: users.id, role: users.role, email: users.email }).from(users).where(eq(users.email, member.email!)).get();

      // A matcher-linked talentId that no longer resolves — skip rather than mis-invite.
      if (member.talentId && !existingUser) {
        errors.push(`Linked performer not found (${member.talentId}).`);
        continue;
      }
      const email = existingUser?.email ?? member.email ?? "";

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

        // In-app notification → the talent's consent document (and their agent).
        void notifyTalentAndReps(db, existingUser.id, {
          type: "licence_request",
          title: `Consent requested for ${production.name}`,
          body: `${companyName} would like your consent on ${production.name}. Review and respond.`,
          href: `/consent/${licenceId}`,
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
