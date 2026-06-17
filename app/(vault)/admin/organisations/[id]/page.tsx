export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, organisationInvites, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import OrgAdminClient from "./org-admin-client";
import OrgSettingsClient from "./org-settings-client";
import CodeTag from "@/app/components/code-tag";
import { ORG_TYPE_LABELS, type OrgType } from "@/lib/organisations/orgTypes";
import OrgTypeBadge from "@/app/components/org-type-badge";

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();

  const [org, memberRows, inviteRows] = await Promise.all([
    db
      .select({
        id: organisations.id,
        name: organisations.name,
        website: organisations.website,
        billingEmail: organisations.billingEmail,
        orgType: organisations.orgType,
        vendorAuditPassed: organisations.vendorAuditPassed,
        shortCode: organisations.shortCode,
        createdAt: organisations.createdAt,
        createdByEmail: users.email,
      })
      .from(organisations)
      .leftJoin(users, eq(users.id, organisations.createdBy))
      .where(eq(organisations.id, id))
      .get(),

    db
      .select({
        userId: organisationMembers.userId,
        memberRole: organisationMembers.memberRole,
        joinedAt: organisationMembers.joinedAt,
        email: users.email,
      })
      .from(organisationMembers)
      .leftJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, id))
      .all(),

    db
      .select({
        id: organisationInvites.id,
        invitedEmail: organisationInvites.invitedEmail,
        expiresAt: organisationInvites.expiresAt,
        acceptedAt: organisationInvites.acceptedAt,
        createdAt: organisationInvites.createdAt,
      })
      .from(organisationInvites)
      .where(eq(organisationInvites.organisationId, id))
      .all(),
  ]);

  if (!org) notFound();

  const members = memberRows.map((m) => ({
    userId: m.userId,
    email: m.email ?? m.userId,
    memberRole: m.memberRole as "owner" | "admin" | "member",
    joinedAt: m.joinedAt,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b flex items-center gap-4" style={{ borderColor: "var(--color-border)" }}>
        <Link
          href="/admin/organisations"
          className="shrink-0 p-1 rounded transition opacity-40 hover:opacity-100"
          style={{ color: "var(--color-ink)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>

        <div
          className="shrink-0 flex items-center justify-center rounded text-sm font-semibold text-white"
          style={{ width: 36, height: 36, background: "var(--color-ink)" }}
        >
          {org.name[0]?.toUpperCase() ?? "O"}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}>
              Admin
            </p>
          </div>
          <h1 className="text-lg font-semibold tracking-tight truncate flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
            <span className="truncate">{org.name}</span>
            <OrgTypeBadge type={org.orgType} />
            <CodeTag code={org.shortCode} />
          </h1>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            Created {fmtDate(org.createdAt)}{org.createdByEmail ? ` by ${org.createdByEmail}` : ""}
          </p>
        </div>
      </div>

      <div className="p-8 max-w-3xl space-y-6">
        {/* Org details */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Details</h2>
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {[
              { label: "Name", value: org.name },
              { label: "Type", value: ORG_TYPE_LABELS[org.orgType as OrgType] ?? org.orgType },
              { label: "Website", value: org.website ?? "—" },
              { label: "Billing Email", value: org.billingEmail ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-5 py-3">
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>{label}</span>
                <span className="text-sm" style={{ color: "var(--color-ink)" }}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Type & audit gate */}
        <OrgSettingsClient
          orgId={id}
          orgType={org.orgType as OrgType}
          vendorAuditPassed={org.vendorAuditPassed}
        />

        {/* Interactive member management */}
        <OrgAdminClient orgId={id} members={members} invites={inviteRows} />
      </div>
    </div>
  );
}
