import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  productions,
  organisations,
  users,
  invites,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole, isComplianceRole } from "@/lib/auth/roles";
import { resolveOwnerAccess } from "@/lib/productions/access";
import { createGrant, listGrantsForScope, GrantScopeError } from "@/lib/compliance/grants";
import { insurerInviteEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { eq, and, isNull } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/**
 * Authorise the caller as someone who can manage this production's insurers:
 * an admin, or a member of the production's organisation (owner/admin for writes).
 * Returns the loaded production, or a NextResponse to short-circuit.
 */
async function authorizeProductionManager(
  db: Db,
  session: { sub: string; email: string; role: string },
  productionId: string,
  requireOwnerOrAdmin: boolean,
) {
  const production = await db
    .select({
      id: productions.id,
      name: productions.name,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();

  if (!production) {
    return { error: NextResponse.json({ error: "Production not found" }, { status: 404 }) };
  }

  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    const access = await resolveOwnerAccess(db, productionId, production.organisationId, session.sub);
    if (!access.isMember) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    if (requireOwnerOrAdmin && !access.canWrite) {
      return {
        error: NextResponse.json({ error: "Forbidden — operational access required" }, { status: 403 }),
      };
    }
  }

  return { production };
}

// GET /api/productions/[id]/insurers
// List active insurer grants on this production plus any pending insurer invites.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeProductionManager(db, session, id, false);
  if ("error" in auth) return auth.error;

  const [grants, pending] = await Promise.all([
    listGrantsForScope(db, "production", id, "insurer"),
    db
      .select({ id: invites.id, email: invites.email, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
      .from(invites)
      .where(
        and(
          eq(invites.productionId, id),
          eq(invites.role, "compliance"),
          isNull(invites.usedAt),
        ),
      )
      .all(),
  ]);

  return NextResponse.json({ insurers: grants, pendingInvites: pending });
}

// POST /api/productions/[id]/insurers  { email }
// Add an insurer to this production (production-scoped grant). If the email
// already belongs to a compliance account, grant it directly; otherwise send a
// compliance-role invite carrying this production + the insurer subtype.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeProductionManager(db, session, id, true);
  if ("error" in auth) return auth.error;
  const { production } = auth;

  let body: { email?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  // Resolve company + coordinator for the email.
  const org = production.organisationId
    ? await db
        .select({ name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, production.organisationId))
        .get()
    : null;
  const companyName = org?.name ?? "Production Company";
  const coordinator = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  const coordinatorEmail = coordinator?.email ?? session.email;

  const now = Math.floor(Date.now() / 1000);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";

  const existingUser = await db
    .select({ id: users.id, role: users.role, trueRole: users.trueRole })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existingUser) {
    // Only compliance accounts can be insurers — never silently elevate a
    // talent/rep/industry account.
    if (!isComplianceRole(existingUser.trueRole ?? existingUser.role)) {
      return NextResponse.json(
        { error: "That email belongs to a non-compliance account and cannot be added as an insurer." },
        { status: 409 },
      );
    }

    let grantId: string;
    try {
      grantId = await createGrant(db, {
        complianceUserId: existingUser.id,
        subtype: "insurer",
        scope: "production",
        scopeId: id,
        grantedBy: session.sub,
      });
    } catch (err) {
      if (err instanceof GrantScopeError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    void (async () => {
      const { subject, html } = insurerInviteEmail({
        recipientEmail: email,
        productionName: production.name,
        companyName,
        coordinatorEmail,
        evidenceUrl: `${baseUrl}/evidence`,
      });
      await sendEmail({ to: email, subject, html });
    })();

    return NextResponse.json({ status: "granted", grantId }, { status: 201 });
  }

  // No account yet — invite as a compliance/insurer watcher bound to this production.
  const inviteId = crypto.randomUUID();
  const expiresAt = now + 7 * 24 * 60 * 60;
  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "compliance",
    invitedBy: session.sub,
    talentId: null,
    message: `You've been added as an insurer on ${production.name}.`,
    usedAt: null,
    expiresAt,
    createdAt: now,
    productionId: id,
    orgSubtype: "insurer", // carries the compliance subtype through signup
  });

  void (async () => {
    const { subject, html } = insurerInviteEmail({
      recipientEmail: email,
      productionName: production.name,
      companyName,
      coordinatorEmail,
      signupUrl: `${baseUrl}/signup?invite=${inviteId}`,
    });
    await sendEmail({ to: email, subject, html });
  })();

  return NextResponse.json({ status: "invited", inviteId }, { status: 201 });
}
