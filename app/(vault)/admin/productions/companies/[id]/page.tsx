export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productionCompanies, productions } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import CompanyEditForm from "./company-edit-form";

export default async function AdminCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();

  const [company] = await db
    .select({
      id: productionCompanies.id,
      name: productionCompanies.name,
      website: productionCompanies.website,
      notes: productionCompanies.notes,
      createdAt: productionCompanies.createdAt,
      updatedAt: productionCompanies.updatedAt,
    })
    .from(productionCompanies)
    .where(eq(productionCompanies.id, id))
    .limit(1)
    .all();

  if (!company) redirect("/admin/productions");

  const linkedProductions = await db
    .select({
      id: productions.id,
      name: productions.name,
      type: productions.type,
      year: productions.year,
      status: productions.status,
      createdAt: productions.createdAt,
    })
    .from(productions)
    .where(eq(productions.companyId, id))
    .orderBy(desc(productions.createdAt))
    .all();

  function ts(d: number): string {
    return new Date(d * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  const TYPE_LABEL: Record<string, string> = {
    film: "Film", tv_series: "TV Series", tv_movie: "TV Movie",
    commercial: "Commercial", game: "Game", music_video: "Music Video", other: "Other",
  };

  const STATUS_COLOR: Record<string, string> = {
    development: "#6b7280", pre_production: "#d97706", production: "#059669",
    post_production: "#2563eb", released: "#4f46e5", cancelled: "#dc2626",
  };

  const STATUS_LABEL: Record<string, string> = {
    development: "Development", pre_production: "Pre-production", production: "Production",
    post_production: "Post-production", released: "Released", cancelled: "Cancelled",
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
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Production Company</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>{company.name}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Created {ts(company.createdAt)} · {linkedProductions.length} production{linkedProductions.length !== 1 ? "s" : ""}
        </p>
      </div>

      <CompanyEditForm
        company={{ ...company, productionCount: linkedProductions.length }}
      />

      {linkedProductions.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>
            Productions ({linkedProductions.length})
          </h2>
          <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
            <div
              className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[500px]"
              style={{
                gridTemplateColumns: "2fr 1fr 0.7fr 1fr",
                color: "var(--color-muted)",
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span>Name</span>
              <span>Type</span>
              <span>Year</span>
              <span>Status</span>
            </div>
            {linkedProductions.map((p) => {
              const statusColor = p.status ? STATUS_COLOR[p.status] ?? "var(--color-muted)" : "var(--color-muted)";
              return (
                <Link
                  key={p.id}
                  href={`/admin/productions/${p.id}`}
                  className="grid items-center px-5 py-3 border-b last:border-0 text-sm min-w-[500px] transition hover:bg-[var(--color-surface)]"
                  style={{ gridTemplateColumns: "2fr 1fr 0.7fr 1fr", borderColor: "var(--color-border)" }}
                >
                  <span className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{p.name}</span>
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>{p.type ? TYPE_LABEL[p.type] ?? p.type : "—"}</span>
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
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
