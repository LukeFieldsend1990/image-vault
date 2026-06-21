import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { users, invites, talentReps, productionCast, licences, productions, organisations } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createGrant } from "@/lib/compliance/grants";
import { mintLicenceCode } from "@/lib/codes/codes";
import { eq, and, isNull, gt } from "drizzle-orm";

const VALID_ROLES = ["talent", "rep", "industry", "licensee", "compliance"] as const;
type Role = (typeof VALID_ROLES)[number];

// Roles that require an invite token
const INVITE_REQUIRED_ROLES: Role[] = ["talent", "rep", "industry", "compliance"];

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; role?: string; inviteToken?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password, role, inviteToken } = body;

  if (!email || !password || !role) {
    return NextResponse.json({ error: "email, password, and role are required" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (password.length < 12) {
    return NextResponse.json({ error: "Password must be at least 12 characters" }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const db = getDb();
  const normalEmail = email.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // Validate invite token for talent and rep roles
  let inviteRow: typeof invites.$inferSelect | undefined;

  if (INVITE_REQUIRED_ROLES.includes(role as Role)) {
    if (!inviteToken) {
      return NextResponse.json(
        { error: "An invitation is required to register as Talent or Representative" },
        { status: 403 }
      );
    }

    inviteRow = await db
      .select()
      .from(invites)
      .where(eq(invites.id, inviteToken))
      .get();

    if (!inviteRow) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 403 });
    }

    if (inviteRow.usedAt !== null) {
      return NextResponse.json({ error: "This invite has already been used" }, { status: 403 });
    }

    if (inviteRow.expiresAt < now) {
      return NextResponse.json({ error: "This invite link has expired" }, { status: 403 });
    }

    if (inviteRow.email !== normalEmail) {
      return NextResponse.json({ error: "This invite was sent to a different email address" }, { status: 403 });
    }

    if (inviteRow.role !== role) {
      return NextResponse.json({ error: "This invite is for a different account type" }, { status: 403 });
    }
  } else if (inviteToken) {
    // Licensee with optional invite — validate if provided but don't require it
    const maybeInvite = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.id, inviteToken),
          isNull(invites.usedAt),
          gt(invites.expiresAt, now)
        )
      )
      .get();

    if (maybeInvite && maybeInvite.email === normalEmail && maybeInvite.role === role) {
      inviteRow = maybeInvite;
    }
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalEmail))
    .get();

  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const nowDate = new Date();

  // users.role has a legacy CHECK(role IN ('talent','rep','licensee','admin')) that
  // predates industry/compliance. Store 'licensee' in users.role and the actual
  // role in users.true_role; JWT creation reads COALESCE(true_role, role).
  const storedRole = (role === "industry" || role === "compliance") ? "licensee" : role;
  const trueRole = (role === "industry" || role === "compliance") ? role : null;

  await db.insert(users).values({
    id: userId,
    email: normalEmail,
    passwordHash,
    role: storedRole as "talent" | "rep" | "licensee" | "admin",
    trueRole,
    createdAt: nowDate,
  });

  // Mark invite as used
  if (inviteRow) {
    await db
      .update(invites)
      .set({ usedAt: now })
      .where(eq(invites.id, inviteRow.id));

    // Auto-link rep to inviting talent if talentId is set
    if (role === "rep" && inviteRow.talentId) {
      await db.insert(talentReps).values({
        id: crypto.randomUUID(),
        talentId: inviteRow.talentId,
        repId: userId,
        invitedBy: inviteRow.invitedBy,
        createdAt: now,
      });
    }

    // Auto-grant a production-scoped compliance grant when an invited watcher
    // (e.g. an insurer added per production) completes signup. The invite's
    // orgSubtype carries the compliance subtype; default to insurer.
    if (inviteRow.productionId && role === "compliance") {
      try {
        await createGrant(db, {
          complianceUserId: userId,
          subtype: (inviteRow.orgSubtype === "union" || inviteRow.orgSubtype === "regulator"
            ? inviteRow.orgSubtype
            : "insurer"),
          scope: "production",
          scopeId: inviteRow.productionId,
          grantedBy: inviteRow.invitedBy,
        });
      } catch {
        // Don't block signup if the grant can't be created; the producer can
        // re-add the insurer, which is idempotent.
      }
    }

    // Auto-link production cast if this invite has a production_id and the role is talent
    if (inviteRow.productionId && role === "talent") {
      // Find the cast row for this invite
      const castRow = await db
        .select()
        .from(productionCast)
        .where(eq(productionCast.inviteId, inviteRow.id))
        .get();

      if (castRow && castRow.licenceTermsJson) {
        try {
          const terms = JSON.parse(castRow.licenceTermsJson) as {
            intendedUse?: string;
            validFrom?: number;
            validTo?: number;
            licenceType?: string;
            territory?: string;
            exclusivity?: string;
            permitAiTraining?: boolean;
            proposedFee?: number;
            projectName?: string;
            productionCompany?: string;
          };

          // Get production name for licence fields
          const prod = await db
            .select({ name: productions.name, organisationId: productions.organisationId })
            .from(productions)
            .where(eq(productions.id, inviteRow.productionId))
            .get();

          let companyName = terms.productionCompany ?? "Production Company";
          if (prod?.organisationId) {
            const org = await db
              .select({ name: organisations.name })
              .from(organisations)
              .where(eq(organisations.id, prod.organisationId))
              .get();
            if (org) companyName = org.name;
          }

          const licenceId = crypto.randomUUID();
          await db.insert(licences).values({
            id: licenceId,
            talentId: userId,
            licenseeId: inviteRow.invitedBy,
            projectName: prod?.name ?? terms.projectName ?? "Production",
            productionCompany: companyName,
            intendedUse: terms.intendedUse ?? "Production use",
            validFrom: terms.validFrom ?? now,
            validTo: terms.validTo ?? now + 365 * 24 * 60 * 60,
            status: "AWAITING_PACKAGE",
            licenceType: (terms.licenceType as typeof licences.$inferInsert["licenceType"]) ?? null,
            territory: terms.territory ?? null,
            exclusivity: (terms.exclusivity as typeof licences.$inferInsert["exclusivity"]) ?? "non_exclusive",
            permitAiTraining: terms.permitAiTraining ?? false,
            proposedFee: terms.proposedFee ?? null,
            productionId: inviteRow.productionId,
            createdAt: now,
          });
          await mintLicenceCode(db, licenceId);

          // Update cast row: link talent, clear terms, set status = linked
          await db
            .update(productionCast)
            .set({
              talentId: userId,
              licenceId,
              linkedAt: now,
              status: "linked",
              licenceTermsJson: null,
            })
            .where(eq(productionCast.id, castRow.id));
        } catch {
          // If something goes wrong, still allow signup to complete
          // The cast row will remain 'invited' and coordinator can retry
        }
      } else if (castRow) {
        // Cast row exists but no licence terms — just link the talent
        await db
          .update(productionCast)
          .set({
            talentId: userId,
            linkedAt: now,
            status: "linked",
          })
          .where(eq(productionCast.id, castRow.id));
      }
    }
  }

  // Store setup token in KV (30 minute TTL)
  const setupToken = crypto.randomUUID();
  const kv = getCloudflareContext().env.SESSIONS_KV;
  const setupPayload: Record<string, unknown> = { userId, email: normalEmail, role };
  if (role === "industry" && inviteRow?.orgSubtype) {
    setupPayload.orgSubtype = inviteRow.orgSubtype;
  }
  await kv.put(`setup:${setupToken}`, JSON.stringify(setupPayload), { expirationTtl: 1800 });

  return NextResponse.redirect(
    new URL(`/setup-2fa?token=${setupToken}`, req.url),
    302
  );
}
