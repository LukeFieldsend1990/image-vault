export const runtime = "edge";

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

  // Auth check: admin or licensee org member
  if (!isAdmin(session.email)) {
    if (session.role !== "licensee") {
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
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const castRows = await db
    .select()
    .from(productionCast)
    .where(eq(productionCast.productionId, id))
    .all();

  // Enrich with talent profile and invite/licence info
  const talentIds = castRows
    .map((r) => r.talentId)
    .filter((t): t is string => t !== null);

  const inviteIds = castRows
    .map((r) => r.inviteId)
    .filter((t): t is string => t !== null);

  const licenceIds = castRows
    .map((r) => r.licenceId)
    .filter((t): t is string => t !== null);

  const [profiles, inviteRows, licenceRows] = await Promise.all([
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
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const inviteMap = new Map(inviteRows.map((i) => [i.id, i]));
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));

  const enriched = castRows.map((row) => ({
    ...row,
    talentProfile: row.talentId ? profileMap.get(row.talentId) ?? null : null,
    invite: row.inviteId ? inviteMap.get(row.inviteId) ?? null : null,
    licence: row.licenceId ? licenceMap.get(row.licenceId) ?? null : null,
    // omit licence terms from list response
    licenceTermsJson: undefined,
  }));

  const castTotal = castRows.length;
  const consentedCount = castRows.filter((r) => r.status === "consented").length;
  const invitedCount = castRows.filter((r) => r.status === "invited").length;

  return NextResponse.json({ cast: enriched, castTotal, consentedCount, invitedCount });
}

interface CastMemberInput {
  email: string;
  characterName?: string;
  department?: string;
  sagMember?: boolean;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  licenceType?: string;
  territory?: string;
  exclusivity?: string;
  permitAiTraining?: boolean;
  proposedFee?: number;
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
    if (session.role !== "licensee") {
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
    if (typeof member.email !== "string" || !member.email) {
      return NextResponse.json({ error: "email is required for each member" }, { status: 400 });
    }
    if (typeof member.intendedUse !== "string" || !member.intendedUse) {
      return NextResponse.json({ error: "intendedUse is required for each member" }, { status: 400 });
    }
    if (typeof member.validFrom !== "number" || typeof member.validTo !== "number") {
      return NextResponse.json({ error: "validFrom and validTo are required for each member" }, { status: 400 });
    }
    members.push({
      email: (member.email as string).toLowerCase().trim(),
      characterName: typeof member.characterName === "string" ? member.characterName : undefined,
      department: typeof member.department === "string" ? member.department : undefined,
      sagMember: typeof member.sagMember === "boolean" ? member.sagMember : false,
      intendedUse: member.intendedUse as string,
      validFrom: member.validFrom as number,
      validTo: member.validTo as number,
      licenceType: typeof member.licenceType === "string" ? member.licenceType : undefined,
      territory: typeof member.territory === "string" ? member.territory : undefined,
      exclusivity: typeof member.exclusivity === "string" ? member.exclusivity : undefined,
      permitAiTraining: typeof member.permitAiTraining === "boolean" ? member.permitAiTraining : false,
      proposedFee: typeof member.proposedFee === "number" ? member.proposedFee : undefined,
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
  const errors: string[] = [];

  for (const member of members) {
    try {
      // Look up user by email
      const existingUser = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, member.email))
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
          intendedUse: member.intendedUse,
          validFrom: member.validFrom,
          validTo: member.validTo,
          status: "PENDING",
          licenceType: (member.licenceType as typeof licences.$inferInsert["licenceType"]) ?? null,
          territory: member.territory ?? null,
          exclusivity: (member.exclusivity as typeof licences.$inferInsert["exclusivity"]) ?? "non_exclusive",
          permitAiTraining: member.permitAiTraining ?? false,
          proposedFee: member.proposedFee ?? null,
          productionId: id,
          createdAt: now,
        });

        await db.insert(productionCast).values({
          id: castId,
          productionId: id,
          talentId: existingUser.id,
          inviteId: null,
          licenceId,
          characterName: member.characterName ?? null,
          department: member.department ?? null,
          sagMember: member.sagMember ?? false,
          status: "linked",
          licenceTermsJson: null,
          addedBy: session.sub,
          addedAt: now,
          linkedAt: now,
        });

        // Fire-and-forget email to talent
        void (async () => {
          const { subject, html } = productionCastLinkedEmail({
            recipientEmail: member.email,
            productionName: production.name,
            companyName,
            coordinatorEmail,
            characterName: member.characterName,
            intendedUse: member.intendedUse,
            proposedFee: member.proposedFee,
            reviewUrl: `${baseUrl}/licences/${licenceId}`,
          });
          await sendEmail({ to: member.email, subject, html });
        })();

        linked++;
      } else {
        // Talent not in system — create invite + cast row with stored licence terms
        const inviteId = crypto.randomUUID();
        const expiresAt = now + 7 * 24 * 60 * 60; // 7 days

        const licenceTerms = {
          intendedUse: member.intendedUse,
          validFrom: member.validFrom,
          validTo: member.validTo,
          licenceType: member.licenceType ?? null,
          territory: member.territory ?? null,
          exclusivity: member.exclusivity ?? "non_exclusive",
          permitAiTraining: member.permitAiTraining ?? false,
          proposedFee: member.proposedFee ?? null,
          projectName: production.name,
          productionCompany: companyName,
        };

        await db.insert(invites).values({
          id: inviteId,
          email: member.email,
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
          status: "invited",
          licenceTermsJson: JSON.stringify(licenceTerms),
          addedBy: session.sub,
          addedAt: now,
          linkedAt: null,
        });

        // Fire-and-forget invite email
        void (async () => {
          const { subject, html } = productionCastInviteEmail({
            recipientEmail: member.email,
            productionName: production.name,
            companyName,
            coordinatorEmail,
            characterName: member.characterName,
            intendedUse: member.intendedUse,
            validFrom: member.validFrom,
            validTo: member.validTo,
            signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
          });
          await sendEmail({ to: member.email, subject, html });
        })();

        invited++;
      }

      created++;
    } catch (err) {
      errors.push(`${member.email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ created, linked, invited, errors }, { status: 201 });
}
