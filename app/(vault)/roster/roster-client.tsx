"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TalentRow {
  talentId: string;
  email: string;
  linkedSince: number;
  packageCount: number;
}

export default function RosterClient() {
  const [roster, setRoster] = useState<TalentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/roster")
      .then((r) => r.json() as Promise<{ roster?: TalentRow[] }>)
      .then((d) => setRoster(d.roster ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>My Roster</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        Talent you manage. Select a name to view and manage their vault.
      </p>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : roster.length === 0 ? (
        <div
          className="rounded border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No talent linked to your account yet.
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
            Ask your talent to add you as a representative from their Account settings.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {roster.map((t) => (
            <Link
              key={t.talentId}
              href={`/roster/${t.talentId}`}
              className="flex items-center justify-between rounded border px-5 py-4 transition hover:shadow-sm"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  style={{ background: "var(--color-ink)", color: "#fff" }}
                >
                  {t.email[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {t.email}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {t.packageCount} ready package{t.packageCount !== 1 ? "s" : ""} · linked{" "}
                    {new Date(t.linkedSince * 1000).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: "var(--color-muted)" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
