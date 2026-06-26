"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface CountryRow {
  id: string;
  name: string;
  topLevelId: string;
  isHome: boolean;
  status: "in_scope" | "removed";
  addedAt: number;
  removedAt: number | null;
}

function formatDate(unix: number | null): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function CountriesPanel({ productionId, canWrite = true }: { productionId: string; canWrite?: boolean }) {
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRemoved, setShowRemoved] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/countries`);
      if (r.ok) {
        const d = await r.json() as { countries: CountryRow[] };
        setCountries(d.countries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => { load(); }, [load]);

  async function remove(countryId: string) {
    if (!confirm("Remove this country from scope? The audit trail is preserved.")) return;
    setRemovingId(countryId);
    try {
      const r = await fetch(`/api/productions/${productionId}/countries/${countryId}`, {
        method: "DELETE",
      });
      if (r.ok) await load();
    } finally {
      setRemovingId(null);
    }
  }

  const visible = countries.filter((c) => showRemoved || c.status === "in_scope");
  const removedCount = countries.filter((c) => c.status === "removed").length;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Countries in scope
        </p>
        {canWrite && (
          <Link
            href={`/productions/${productionId}/countries/add`}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add country
          </Link>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Every country where data activity happens for this show. The right local data protection rules apply to each one.
      </p>

      {removedCount > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowRemoved((v) => !v)}
            className="text-xs rounded px-2 py-1"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            {showRemoved ? "Hide removed" : `Show removed (${removedCount})`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded p-4 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
          No countries yet. Add the first one to set the compliance scope.
        </div>
      ) : (
        <div className="rounded overflow-hidden divide-y" style={{ border: "1px solid var(--color-border)" }}>
          {visible.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-4 py-3"
              style={{ background: "var(--color-surface)", opacity: c.status === "removed" ? 0.55 : 1 }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span style={{ color: "var(--color-muted)" }} aria-hidden>
                  {c.isHome ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {c.name}
                    {c.isHome && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-muted)" }}>· Home</span>}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {c.status === "removed"
                      ? `No longer in scope · removed ${formatDate(c.removedAt)}`
                      : `In scope · added ${formatDate(c.addedAt)}`}
                  </p>
                </div>
              </div>
              {canWrite && !c.isHome && c.status === "in_scope" && (
                <button
                  onClick={() => remove(c.id)}
                  disabled={removingId === c.id}
                  className="text-xs rounded px-2 py-1"
                  style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                >
                  {removingId === c.id ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
