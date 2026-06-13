"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Production {
  id: string;
  name: string;
  companyName: string | null;
  type: string | null;
  year: number | null;
  status: string | null;
  sagProjectNumber: string | null;
  organisationId: string | null;
  createdAt: number;
  licenceCount: number;
  cast: { total: number; consented: number; invited: number; linked: number } | null;
}

const TYPE_LABELS: Record<string, string> = {
  film: "Feature Film",
  tv_series: "TV Series",
  tv_movie: "TV Movie",
  commercial: "Commercial",
  game: "Game",
  music_video: "Music Video",
  other: "Production",
};

const STATUS_LABELS: Record<string, string> = {
  development: "Development",
  pre_production: "Pre-Production",
  production: "In Production",
  post_production: "Post-Production",
  released: "Released",
  cancelled: "Cancelled",
};

const STATUS_COLOURS: Record<string, string> = {
  development: "#6b7280",
  pre_production: "#b45309",
  production: "#166534",
  post_production: "#7c3aed",
  released: "#0891b2",
  cancelled: "#374151",
};

function PhaseIndicator({ status }: { status: string | null }) {
  if (!status) return null;
  const colour = STATUS_COLOURS[status] ?? "#6b7280";
  const label = STATUS_LABELS[status] ?? status;
  const pulse = status === "production";

  return (
    <span className="flex items-center gap-1.5">
      {pulse ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: colour }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: colour }} />
        </span>
      ) : (
        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: colour }} />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: colour }}>
        {label}
      </span>
    </span>
  );
}

export default function ProductionsClient() {
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch("/api/productions/list")
      .then((r) => r.json() as Promise<{ productions?: Production[] }>)
      .then((d) => setProductions(d.productions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
            Your Productions
          </p>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Productions
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Manage cast, licences, and compliance for each production.
          </p>
        </div>
        <Link
          href="/productions/new"
          className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white shrink-0"
          style={{ background: "var(--color-accent)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Production
        </Link>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg animate-pulse" style={{ height: 140, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && productions.length === 0 && (
        <div
          className="rounded-lg px-8 py-14 text-center"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-4" style={{ color: "var(--color-muted)" }}>
            <rect x="2" y="7" width="20" height="15" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          </svg>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>No productions yet</p>
          <p className="text-xs mb-6 max-w-xs mx-auto" style={{ color: "var(--color-muted)" }}>
            Create a production to begin cast onboarding and SAG-AFTRA compliance tracking.
          </p>
          <Link
            href="/productions/new"
            className="inline-flex items-center gap-2 rounded px-5 py-2 text-sm font-medium text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Create your first production
          </Link>
        </div>
      )}

      {/* Production cards */}
      <div className="space-y-4">
        {productions.map((p) => (
          <Link
            key={p.id}
            href={`/productions/${p.id}`}
            className="group block rounded-lg overflow-hidden transition-opacity hover:opacity-90"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            {/* Header band */}
            <div className="px-6 pt-5 pb-5" style={{ borderBottom: "1px solid var(--color-border)" }}>
              {/* Eyebrow */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  {p.type && (
                    <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      {TYPE_LABELS[p.type] ?? p.type}
                    </span>
                  )}
                  {p.type && p.year && (
                    <span className="text-[10px]" style={{ color: "var(--color-border)" }}>·</span>
                  )}
                  {p.year && (
                    <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      {p.year}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <PhaseIndicator status={p.status} />
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    className="transition-transform group-hover:translate-x-0.5"
                    style={{ color: "var(--color-muted)" }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>

              {/* Title + metrics */}
              <div className="flex items-end justify-between gap-6">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight leading-none" style={{ color: "var(--color-ink)" }}>
                    {p.name}
                  </h2>
                  {p.companyName && (
                    <p className="mt-1.5 text-sm" style={{ color: "var(--color-muted)" }}>
                      {p.companyName}
                    </p>
                  )}
                </div>

                {/* Right metrics */}
                <div className="text-right shrink-0 space-y-1">
                  <div>
                    <p className="text-xl font-semibold tabular-nums leading-none" style={{ color: "var(--color-ink)" }}>
                      {p.licenceCount}
                    </p>
                    <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {p.licenceCount === 1 ? "Licence" : "Licences"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer band — SAG + cast progress */}
            <div className="px-6 py-3 flex items-center gap-3 flex-wrap" style={{ background: "var(--color-bg)" }}>
              {p.sagProjectNumber ? (
                <span
                  className="inline-flex text-[10px] font-mono font-semibold px-2 py-0.5 rounded"
                  style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}
                >
                  SAG-AFTRA · {p.sagProjectNumber}
                </span>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  No SAG-AFTRA project number
                </span>
              )}
              {p.cast && p.cast.total > 0 ? (() => {
                const pct = Math.round((p.cast.consented / p.cast.total) * 100);
                const colour = pct === 100 ? "#166534" : pct > 50 ? "#b45309" : "#c0392b";
                return (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                      {p.cast.consented}/{p.cast.total} cast consented
                    </span>
                    <span className="inline-flex w-20 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                      <span className="h-full rounded-full" style={{ width: `${pct}%`, background: colour }} />
                    </span>
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: colour }}>{pct}%</span>
                  </span>
                );
              })() : (
                <span
                  className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded ml-auto"
                  style={{ background: "rgba(180,83,9,0.08)", color: "#b45309" }}
                >
                  No cast added yet
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
