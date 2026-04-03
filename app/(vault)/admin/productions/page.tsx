export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productions, productionCompanies, licences } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import Link from "next/link";

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
      createdAt: productions.createdAt,
    })
    .from(productions)
    .leftJoin(productionCompanies, eq(productionCompanies.id, productions.companyId))
    .orderBy(desc(productions.createdAt))
    .all();

  // Licence counts per production
  const licenceCounts = await db
    .select({ productionId: licences.productionId, n: sql<number>`count(*)` })
    .from(licences)
    .groupBy(licences.productionId)
    .all();
  const licenceCountMap = new Map(licenceCounts.map((l) => [l.productionId, l.n]));

  // Also get all companies for the companies section
  const allCompanies = await db
    .select({
      id: productionCompanies.id,
      name: productionCompanies.name,
      website: productionCompanies.website,
      createdAt: productionCompanies.createdAt,
    })
    .from(productionCompanies)
    .orderBy(desc(productionCompanies.createdAt))
    .all();

  // Production counts per company
  const prodCounts = await db
    .select({ companyId: productions.companyId, n: sql<number>`count(*)` })
    .from(productions)
    .groupBy(productions.companyId)
    .all();
  const prodCountMap = new Map(prodCounts.map((p) => [p.companyId, p.n]));

  function ts(d: number): string {
    return new Date(d * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Productions</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {allProductions.length} production{allProductions.length !== 1 ? "s" : ""} · {allCompanies.length} compan{allCompanies.length !== 1 ? "ies" : "y"}
        </p>
      </div>

      {/* Productions table */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Productions</h2>
      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
      <div className="rounded border overflow-x-auto mb-10" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[700px]"
          style={{
            gridTemplateColumns: "2fr 1.5fr 1fr 0.7fr 1fr 0.7fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Name</span>
          <span>Company</span>
          <span>Type</span>
          <span>Year</span>
          <span>Status</span>
          <span>Licences</span>
        </div>

        {allProductions.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No productions yet. They are created when licensees submit licence requests.</p>
        )}

        {allProductions.map((p) => {
          const count = licenceCountMap.get(p.id) ?? 0;
          const statusColor = p.status ? STATUS_COLOR[p.status] ?? "var(--color-muted)" : "var(--color-muted)";

          return (
            <Link
              key={p.id}
              href={`/admin/productions/${p.id}`}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[700px] transition hover:bg-[var(--color-surface)]"
              style={{
                gridTemplateColumns: "2fr 1.5fr 1fr 0.7fr 1fr 0.7fr",
                borderColor: "var(--color-border)",
              }}
            >
              <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{p.name}</span>
              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{p.companyName ?? "—"}</span>
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
            </Link>
          );
        })}
      </div>

      {/* Companies table */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Production Companies</h2>
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
            <div
              key={c.id}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[500px]"
              style={{
                gridTemplateColumns: "2fr 1.5fr 1fr 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{c.name}</span>
              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{c.website ?? "—"}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{prodCount > 0 ? prodCount : "—"}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(c.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
