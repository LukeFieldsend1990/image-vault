"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface TalentRow {
  id: string;
  email: string;
  fullName: string | null;
  profileImageUrl: string | null;
  packageCount: number;
}

export default function DirectoryClient() {
  const [talent, setTalent] = useState<TalentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/talent")
      .then((r) => r.json() as Promise<{ talent?: TalentRow[] }>)
      .then((d) => setTalent(d.talent ?? []))
      .catch(() => setError("Failed to load directory"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Talent Directory
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Browse available talent and request access to scan packages.
        </p>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
      )}
      {error && (
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}

      {!loading && !error && talent.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No talent available at this time.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {talent.map((t) => (
          <Link
            key={t.id}
            href={`/talent/${t.id}`}
            className="block rounded border p-5 transition hover:shadow-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            {t.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.profileImageUrl}
                alt={t.fullName ?? t.email}
                className="mb-3 h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "var(--color-ink)", color: "#fff" }}
              >
                {(t.fullName ?? t.email)[0].toUpperCase()}
              </div>
            )}
            <p className="truncate text-sm font-medium" style={{ color: "var(--color-ink)" }}>
              {t.fullName ?? t.email}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
              {t.packageCount} scan package{t.packageCount !== 1 ? "s" : ""} available
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
