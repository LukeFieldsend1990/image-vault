export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, licences, scanPackages, users, organisations, organisationMembers, productionCast, talentProfiles, invites } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import ProductionEditForm from "./production-edit-form";
import CastResolveButton from "./cast-resolve-button";

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

  // Cast onboarding
  const castRows = await db
    .select({
      id: productionCast.id,
      talentId: productionCast.talentId,
      inviteId: productionCast.inviteId,
      licenceId: productionCast.licenceId,
      actorName: productionCast.actorName,
      characterName: productionCast.characterName,
      department: productionCast.department,
      sagMember: productionCast.sagMember,
      status: productionCast.status,
      addedAt: productionCast.addedAt,
      linkedAt: productionCast.linkedAt,
    })
    .from(productionCast)
    .where(eq(productionCast.productionId, id))
    .orderBy(desc(productionCast.addedAt))
    .all();

  const castTalentIds = castRows.map((c) => c.talentId).filter(Boolean) as string[];
  const castInviteIds = castRows.map((c) => c.inviteId).filter(Boolean) as string[];
  const [castProfiles, castInvites] = await Promise.all([
    castTalentIds.length > 0
      ? db.select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName }).from(talentProfiles).where(inArray(talentProfiles.userId, castTalentIds)).all()
      : Promise.resolve([]),
    castInviteIds.length > 0
      ? db.select({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt, usedAt: invites.usedAt }).from(invites).where(inArray(invites.id, castInviteIds)).all()
      : Promise.resolve([]),
  ]);
  const profileMap = new Map(castProfiles.map((p) => [p.userId, p.fullName]));
  const inviteMap = new Map(castInvites.map((i) => [i.id, i]));

  const CAST_STATUS_COLOR: Record<string, string> = {
    placeholder: "#6b7280", invited: "#d97706", linked: "#2563eb", scan_uploaded: "#7c3aed", consented: "#059669", declined: "#dc2626",
  };
  const CAST_STATUS_LABEL: Record<string, string> = {
    placeholder: "Placeholder", invited: "Invited", linked: "Linked", scan_uploaded: "Reviewing", consented: "Consented", declined: "Declined",
  };

  // Cast summary counts
  const castConsented = castRows.filter((c) => c.status === "consented").length;
  const castTotal = castRows.length;

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

      {/* Cast Onboarding */}
      {castRows.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Cast Onboarding ({castConsented}/{castTotal} consented)
            </h2>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${castTotal > 0 ? Math.round((castConsented / castTotal) * 100) : 0}%`,
                    background: castConsented === castTotal ? "#059669" : "#d97706",
                  }}
                />
              </div>
              <span className="text-xs font-medium" style={{ color: castConsented === castTotal ? "#059669" : "#d97706" }}>
                {castTotal > 0 ? Math.round((castConsented / castTotal) * 100) : 0}%
              </span>
            </div>
          </div>
          <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <div
              className="grid text-[10px] uppercase tracking-widest font-semibold px-4 py-2.5 min-w-[600px]"
              style={{
                gridTemplateColumns: "2fr 1.5fr 1fr 0.7fr 1fr 1fr",
                color: "var(--color-muted)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Talent</span>
              <span>Character</span>
              <span>Dept</span>
              <span>SAG</span>
              <span>Status</span>
              <span>Added</span>
            </div>
            {castRows.map((c) => {
              const name = c.talentId
                ? (profileMap.get(c.talentId) ?? c.talentId.slice(0, 8))
                : (inviteMap.get(c.inviteId ?? "")?.email ?? c.actorName ?? "—");
              const statusColor = CAST_STATUS_COLOR[c.status] ?? "#6b7280";
              return (
                <div
                  key={c.id}
                  className="grid items-center px-4 py-3 border-b last:border-0 text-sm min-w-[600px]"
                  style={{ gridTemplateColumns: "2fr 1.5fr 1fr 0.7fr 1fr 1fr", borderColor: "var(--color-border)" }}
                >
                  <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>{name}</span>
                  <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{c.characterName ?? "—"}</span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{c.department ?? "—"}</span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{c.sagMember ? "✓" : "—"}</span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded" style={{ background: `${statusColor}18`, color: statusColor }}>
                      {CAST_STATUS_LABEL[c.status] ?? c.status}
                    </span>
                    {c.status === "placeholder" && (
                      <CastResolveButton productionId={id} castId={c.id} actorName={c.actorName ?? "this actor"} />
                    )}
                  </span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(c.addedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
