import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, licences, productionCast, organisations } from "@/lib/db/schema";
import { eq, sql, desc, inArray } from "drizzle-orm";
import Link from "next/link";
import NewCompanyButton from "./new-company-button";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";

const TYPE_LABEL: Record<string, string> = {
  film: "Film",
  tv_series: "TV Series",
  tv_movie: "TV Movie",
  commercial: "Commercial",
  game: "Game",
  music_video: "Music Video",
  other: "Other",
};

const STATUS_LABEL: Record<string, string> = {
  development: "Development",
  pre_production: "Pre-production",
  production: "Production",
  post_production: "Post-production",
  released: "Released",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  development: "#6b7280",
  pre_production: "#d97706",
  production: "#059669",
  post_production: "#2563eb",
  released: "#4f46e5",
  cancelled: "#dc2626",
};

export default async function AdminProductionsPage() {
  await requireAdmin();
  const db = getDb();

  const allProductions = await db
    .select({
      id: productions.id,
      name: productions.name,
      companyId: productions.companyId,
      companyName: productionCompanies.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      shortCode: productions.shortCode,
      sagProjectNumber: productions.sagProjectNumber,
      organisationId: productions.organisationId,
      createdAt: productions.createdAt,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .orderBy(desc(productions.createdAt))
    .all();

  const productionIds = allProductions.map((p) => p.id);

  // Licence counts, cast stats, org names — all batched
  const [licenceCounts, castRows, orgRows] = await Promise.all([
    db.select({ productionId: licences.productionId, n: sql<number>`count(*)` })
      .from(licences).groupBy(licences.productionId).all(),
    productionIds.length > 0
      ? db.select({ productionId: productionCast.productionId, status: productionCast.status })
          .from(productionCast).where(inArray(productionCast.productionId, productionIds)).all()
      : Promise.resolve([]),
    (() => {
      const orgIds = [...new Set(allProductions.map((p) => p.organisationId).filter(Boolean))] as string[];
      return orgIds.length > 0
        ? db.select({ id: organisations.id, name: organisations.name, orgType: organisations.orgType, shortCode: organisations.shortCode }).from(organisations).where(inArray(organisations.id, orgIds)).all()
        : Promise.resolve([] as { id: string; name: string; orgType: string; shortCode: string | null }[]);
    })(),
  ]);

  const licenceCountMap = new Map(licenceCounts.map((l) => [l.productionId, l.n]));
  const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));
  const orgTypeMap = new Map(orgRows.map((o) => [o.id, o.orgType]));
  const orgShortCodeMap = new Map(orgRows.map((o) => [o.id, o.shortCode]));

  // Cast onboarding stats per production
  const castStatMap = new Map<string, { total: number; consented: number; invited: number; linked: number }>();
  for (const c of castRows) {
    const cur = castStatMap.get(c.productionId) ?? { total: 0, consented: 0, invited: 0, linked: 0 };
    cur.total++;
    if (c.status === "consented") cur.consented++;
    else if (c.status === "invited") cur.invited++;
    else cur.linked++;
    castStatMap.set(c.productionId, cur);
  }

  // Production companies are organisations now (production_company / studio
  // subtypes) — the same entities shown on /admin/organisations. Sourcing this
  // section from organisations keeps the two screens reconciled.
  const allCompanies = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      website: organisations.website,
      orgType: organisations.orgType,
      shortCode: organisations.shortCode,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(inArray(organisations.orgType, ["production_company", "studio"]))
    .orderBy(desc(organisations.createdAt))
    .all();

  // Production counts per organisation.
  const prodCounts = await db
    .select({ organisationId: productions.organisationId, n: sql<number>`count(*)` })
    .from(productions)
    .groupBy(productions.organisationId)
    .all();
  const prodCountMap = new Map(prodCounts.map((p) => [p.organisationId, p.n]));

  function ts(d: number): string {
    return new Date(d * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Productions</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
            {allProductions.length} production{allProductions.length !== 1 ? "s" : ""} · {allCompanies.length} compan{allCompanies.length !== 1 ? "ies" : "y"}
          </p>
        </div>
        <Link
          href="/admin/productions/invite"
          className="shrink-0 flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--color-accent)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Set up & invite
        </Link>
      </div>

      {/* Productions table */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Productions</h2>
      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
      <div className="rounded border overflow-x-auto mb-10" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[900px]"
          style={{
            gridTemplateColumns: "2fr 1.2fr 0.8fr 0.6fr 0.9fr 0.7fr 1.2fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Name</span>
          <span>Organisation</span>
          <span>Type</span>
          <span>Year</span>
          <span>Status</span>
          <span>Licences</span>
          <span>Cast Onboarding</span>
        </div>

        {allProductions.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No productions yet.</p>
        )}

        {allProductions.map((p) => {
          const count = licenceCountMap.get(p.id) ?? 0;
          const cast = castStatMap.get(p.id);
          const castPct = cast && cast.total > 0 ? Math.round((cast.consented / cast.total) * 100) : null;
          const castColor = castPct === null ? "var(--color-muted)" : castPct === 100 ? "#059669" : castPct > 50 ? "#d97706" : "#dc2626";
          const statusColor = p.status ? STATUS_COLOR[p.status] ?? "var(--color-muted)" : "var(--color-muted)";
          const orgName = p.organisationId ? (orgNameMap.get(p.organisationId) ?? "—") : "—";
          const orgType = p.organisationId ? orgTypeMap.get(p.organisationId) : null;
          const orgShortCode = p.organisationId ? orgShortCodeMap.get(p.organisationId) : null;

          return (
            <Link
              key={p.id}
              href={`/admin/productions/${p.id}`}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[900px] transition hover:bg-[var(--color-surface)]"
              style={{
                gridTemplateColumns: "2fr 1.2fr 0.8fr 0.6fr 0.9fr 0.7fr 1.2fr",
                borderColor: "var(--color-border)",
              }}
            >
              <div className="min-w-0">
                <span className="font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                  <span className="truncate">{p.name}</span>
                  <CodeTag code={p.shortCode} />
                </span>
                {p.sagProjectNumber && (
                  <span className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>SAG {p.sagProjectNumber}</span>
                )}
              </div>
              <span className="text-xs truncate flex items-center gap-1.5" style={{ color: "var(--color-muted)" }}>
                <span className="truncate">{orgName}</span>
                <OrgTypeBadge type={orgType} />
                <CodeTag code={orgShortCode} />
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {p.type ? TYPE_LABEL[p.type] ?? p.type : "—"}
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{p.year ?? "—"}</span>
              <span>
                {p.status ? (
                  <span
                    className="inline-flex text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
                    style={{ background: `${statusColor}18`, color: statusColor }}
                  >
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                )}
              </span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{count > 0 ? count : "—"}</span>
              <div>
                {cast && cast.total > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: castColor }}>{cast.consented}/{cast.total}</span>
                      <span className="text-[10px]" style={{ color: castColor }}>{castPct}%</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                      <div className="h-full rounded-full" style={{ width: `${castPct}%`, background: castColor }} />
                    </div>
                    {(cast.invited > 0 || cast.linked > 0) && (
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                        {cast.invited > 0 && `${cast.invited} invited `}
                        {cast.linked > 0 && `${cast.linked} pending`}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Companies table */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>Production Companies</h2>
        <NewCompanyButton />
      </div>
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[500px]"
          style={{
            gridTemplateColumns: "2fr 1.5fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Name</span>
          <span>Website</span>
          <span>Productions</span>
          <span>Created</span>
        </div>

        {allCompanies.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No companies yet.</p>
        )}

        {allCompanies.map((c) => {
          const prodCount = prodCountMap.get(c.id) ?? 0;
          return (
            <Link
              key={c.id}
              href={`/admin/organisations/${c.id}`}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[500px] transition hover:bg-[var(--color-surface)]"
              style={{
                gridTemplateColumns: "2fr 1.5fr 1fr 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              <span className="font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                <span className="truncate">{c.name}</span>
                <OrgTypeBadge type={c.orgType} />
                <CodeTag code={c.shortCode} />
              </span>
              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{c.website ?? "—"}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{prodCount > 0 ? prodCount : "—"}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(c.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
