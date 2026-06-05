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
}

const TYPE_LABELS: Record<string, string> = {
  film: "Film",
  tv_series: "TV Series",
  tv_movie: "TV Movie",
  commercial: "Commercial",
  game: "Game",
  music_video: "Music Video",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  development: "Development",
  pre_production: "Pre-Production",
  production: "Production",
  post_production: "Post-Production",
  released: "Released",
  cancelled: "Cancelled",
};

const STATUS_COLOURS: Record<string, string> = {
  development: "#6b7280",
  pre_production: "#b45309",
  production: "#c0392b",
  post_production: "#7c3aed",
  released: "#166534",
  cancelled: "#374151",
};

export default function ProductionsClient() {
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/productions/list")
      .then((r) => r.json() as Promise<{ productions?: Production[] }>)
      .then((d) => setProductions(d.productions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>
            Your Productions
          </p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
            Productions
          </h1>
        </div>
        <Link
          href="/productions/new"
          className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--color-accent)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Production
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded p-4 animate-pulse" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", height: 80 }} />
          ))}
        </div>
      ) : productions.length === 0 ? (
        <div className="rounded p-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <div className="mb-3" style={{ color: "var(--color-muted)" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
              <rect x="2" y="7" width="20" height="15" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            </svg>
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>No productions yet</p>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            Create a production to start onboarding cast members for SAG-AFTRA compliance.
          </p>
          <Link
            href="/productions/new"
            className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Create your first production
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {productions.map((p) => (
            <Link
              key={p.id}
              href={`/productions/${p.id}`}
              className="block rounded p-4 transition-colors"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-sm truncate" style={{ color: "var(--color-text)" }}>{p.name}</span>
                    {p.type && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>
                        {TYPE_LABELS[p.type] ?? p.type}
                      </span>
                    )}
                    {p.sagProjectNumber && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}>
                        SAG {p.sagProjectNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {p.companyName && (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>{p.companyName}</span>
                    )}
                    {p.year && (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>{p.year}</span>
                    )}
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {p.licenceCount} licence{p.licenceCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {p.status && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${STATUS_COLOURS[p.status] ?? "#6b7280"}20`, color: STATUS_COLOURS[p.status] ?? "#6b7280" }}
                    >
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
