import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers, users } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";
import { isVendorOrgType } from "@/lib/organisations/orgTypes";

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function AdminOrganisationsPage() {
  await requireAdmin();
  const db = getDb();

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      orgType: organisations.orgType,
      shortCode: organisations.shortCode,
      vendorAuditPassed: organisations.vendorAuditPassed,
      website: organisations.website,
      billingEmail: organisations.billingEmail,
      createdAt: organisations.createdAt,
      createdByEmail: users.email,
    })
    .from(organisations)
    .leftJoin(users, eq(users.id, organisations.createdBy))
    .orderBy(desc(organisations.createdAt))
    .all();

  const memberCounts = await db
    .select({ organisationId: organisationMembers.organisationId, n: count() })
    .from(organisationMembers)
    .groupBy(organisationMembers.organisationId)
    .all();

  const countMap = new Map(memberCounts.map((r) => [r.organisationId, r.n]));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Organisations</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {rows.length} organisation{rows.length !== 1 ? "s" : ""} registered on the platform.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No organisations yet.</p>
      ) : (
        <>
          <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
          <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <div
              className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[860px]"
              style={{
                gridTemplateColumns: "2.5fr 1.5fr 1.5fr 0.6fr 1fr 0.8fr",
                color: "var(--color-muted)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Organisation</span>
              <span>Website</span>
              <span>Billing Email</span>
              <span>Members</span>
              <span>Created By</span>
              <span></span>
            </div>

            {rows.map((org) => {
              const memberCount = countMap.get(org.id) ?? 0;
              return (
                <div
                  key={org.id}
                  className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[860px]"
                  style={{
                    gridTemplateColumns: "2.5fr 1.5fr 1.5fr 0.6fr 1fr 0.8fr",
                    borderColor: "var(--color-border)",
                  }}
                >
                  {/* Name + created date */}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                      <span className="truncate">{org.name}</span>
                      <OrgTypeBadge type={org.orgType} />
                      <CodeTag code={org.shortCode} />
                      {isVendorOrgType(org.orgType) && (
                        <span
                          className="text-[10px] shrink-0"
                          style={{ color: org.vendorAuditPassed ? "var(--color-accent)" : "var(--color-muted)" }}
                          title={org.vendorAuditPassed ? "Environment audit passed" : "Environment audit not passed"}
                        >
                          {org.vendorAuditPassed ? "Audit ✓" : "Audit —"}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>{fmtDate(org.createdAt)}</p>
                  </div>

                  {/* Website */}
                  <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                    {org.website ?? "—"}
                  </span>

                  {/* Billing email */}
                  <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                    {org.billingEmail ?? "—"}
                  </span>

                  {/* Member count */}
                  <span
                    className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded w-fit"
                    style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                  >
                    {memberCount}
                  </span>

                  {/* Created by */}
                  <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                    {org.createdByEmail ?? "—"}
                  </span>

                  {/* Manage link */}
                  <Link
                    href={`/admin/organisations/${org.id}`}
                    className="text-xs font-medium transition hover:opacity-80 text-right"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Manage →
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
