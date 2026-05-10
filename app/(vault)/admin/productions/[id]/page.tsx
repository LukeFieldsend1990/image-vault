export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, licences, scanPackages, users, organisations, organisationMembers } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import ProductionEditForm from "./production-edit-form";

export default async function AdminProductionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();

  const [production] = await db
    .select({
      id: productions.id,
      name: productions.name,
      companyId: productions.companyId,
      companyName: productionCompanies.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      imdbId: productions.imdbId,
      tmdbId: productions.tmdbId,
      director: productions.director,
      vfxSupervisor: productions.vfxSupervisor,
      notes: productions.notes,
      createdAt: productions.createdAt,
      updatedAt: productions.updatedAt,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .where(eq(productions.id, id))
    .limit(1)
    .all();

  if (!production) redirect("/admin/productions");

  // Linked licences
  const linkedLicences = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      talentEmail: users.email,
      packageName: scanPackages.name,
      status: licences.status,
      agreedFee: licences.agreedFee,
      createdAt: licences.createdAt,
      licenseeId: licences.licenseeId,
      directOrgId: licences.organisationId,
    })
    .from(licences)
    .leftJoin(users, eq(users.id, licences.talentId))
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .where(eq(licences.productionId, id))
    .orderBy(desc(licences.createdAt))
    .all();

  // Resolve org names — direct link first, fallback to licensee membership
  const directOrgIds = linkedLicences.map((l) => l.directOrgId).filter(Boolean) as string[];
  const licenseeIds = linkedLicences.map((l) => l.licenseeId).filter(Boolean) as string[];

  const [directOrgs, membershipRows] = await Promise.all([
    directOrgIds.length > 0
      ? db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, directOrgIds)).all()
      : Promise.resolve([] as { id: string; name: string }[]),
    licenseeIds.length > 0
      ? db.select({ userId: organisationMembers.userId, organisationId: organisationMembers.organisationId })
          .from(organisationMembers)
          .where(inArray(organisationMembers.userId, licenseeIds))
          .all()
      : Promise.resolve([] as { userId: string; organisationId: string }[]),
  ]);

  const directOrgMap = new Map(directOrgs.map((o) => [o.id, o.name]));

  // For licensees in an org without a direct link, fetch those org names
  const indirectOrgIds = [...new Set(membershipRows.map((m) => m.organisationId))];
  const indirectOrgs = indirectOrgIds.length > 0
    ? await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, indirectOrgIds)).all()
    : [];
  const indirectOrgMap = new Map(indirectOrgs.map((o) => [o.id, o.name]));
  const licenseeOrgMap = new Map(membershipRows.map((m) => [m.userId, indirectOrgMap.get(m.organisationId) ?? null]));

  // Per-licence org name: prefer direct link, else licensee membership
  const licenceOrgName = (l: { directOrgId: string | null; licenseeId: string }) =>
    (l.directOrgId ? directOrgMap.get(l.directOrgId) : null) ?? licenseeOrgMap.get(l.licenseeId) ?? null;

  function ts(d: number): string {
    return new Date(d * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  const STATUS_COLOR: Record<string, string> = {
    AWAITING_PACKAGE: "#7c3aed",
    PENDING: "#d97706",
    APPROVED: "#059669",
    DENIED: "#dc2626",
    REVOKED: "#6b7280",
    EXPIRED: "#6b7280",
    SCRUB_PERIOD: "#c0392b",
    CLOSED: "#374151",
    OVERDUE: "#991b1b",
  };

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/admin/productions" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to productions
      </Link>

      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Production</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>{production.name}</h1>
        {production.companyName && (
          <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>{production.companyName}</p>
        )}
      </div>

      <ProductionEditForm production={production} />

      {/* Linked licences */}
      {linkedLicences.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>
            Linked Licences ({linkedLicences.length})
          </h2>
          <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <div
              className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[500px]"
              style={{
                gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr 1fr",
                color: "var(--color-muted)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Talent</span>
              <span>Package</span>
              <span>Status</span>
              <span>Fee</span>
              <span>Date</span>
            </div>
            {linkedLicences.map((l) => {
              const orgName = licenceOrgName(l);
              return (
              <div
                key={l.id}
                className="grid items-center px-5 py-3 border-b last:border-0 text-sm min-w-[500px]"
                style={{
                  gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr 1fr",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="min-w-0">
                  <span className="text-xs truncate block" style={{ color: "var(--color-text)" }}>{l.talentEmail ?? "—"}</span>
                  {orgName && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5"
                      style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb" }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      {orgName}
                    </span>
                  )}
                </div>
                <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{l.packageName ?? "—"}</span>
                <span
                  className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                  style={{
                    background: `${STATUS_COLOR[l.status ?? ""] ?? "var(--color-muted)"}18`,
                    color: STATUS_COLOR[l.status ?? ""] ?? "var(--color-muted)",
                  }}
                >
                  {l.status}
                </span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {l.agreedFee ? `$${(l.agreedFee / 100).toLocaleString()}` : "—"}
                </span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(l.createdAt)}</span>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
