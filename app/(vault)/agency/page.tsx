import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { organisationMembers, invites, users } from "@/lib/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getAgencyMembership } from "@/lib/agency/membership";
import AgencyClient, { type AgentMember, type PendingInvite } from "./agency-client";

async function getSession(): Promise<{ userId: string; role: string } | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { sub?: string; role?: string };
    return { userId: payload.sub ?? "", role: payload.role ?? "" };
  } catch {
    return null;
  }
}

export default async function AgencyPage() {
  const session = await getSession();
  if (!session?.userId) redirect("/login");

  const db = getDb();
  const membership = await getAgencyMembership(db, session.userId);

  if (!membership) {
    return (
      <div className="p-8 max-w-2xl">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Agency</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>No agency</h1>
        <p className="text-sm mt-2" style={{ color: "var(--color-muted)" }}>
          You&apos;re not currently linked to a talent agency. If you should be, ask an
          administrator to attach your account to your agency.
        </p>
      </div>
    );
  }

  const canManage = membership.memberRole === "owner" || membership.memberRole === "admin";

  const members = (await db
    .select({
      userId: organisationMembers.userId,
      email: users.email,
      shortCode: users.shortCode,
      memberRole: organisationMembers.memberRole,
      joinedAt: organisationMembers.joinedAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(eq(organisationMembers.organisationId, membership.organisationId))
    .all()) as AgentMember[];

  const pending = (await db
    .select({ id: invites.id, email: invites.email, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(
      eq(invites.organisationId, membership.organisationId),
      isNull(invites.usedAt),
      gt(invites.expiresAt, sql`(unixepoch())`),
    ))
    .all()) as PendingInvite[];

  return (
    <AgencyClient
      organisationId={membership.organisationId}
      organisationName={membership.organisationName}
      shortCode={membership.shortCode}
      canManage={canManage}
      initialMembers={members}
      initialPending={pending}
    />
  );
}
