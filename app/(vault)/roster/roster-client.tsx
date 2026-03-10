"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TalentRow {
  talentId: string;
  email: string;
  linkedSince: number;
  packageCount: number;
  totalSizeBytes: number | null;
  fullName: string | null;
  profileImageUrl: string | null;
  tmdbId: number | null;
}

function fmt(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return (n / 1e3).toFixed(0) + " KB";
}

function TalentAvatar({ name, imageUrl, email }: { name: string | null; imageUrl: string | null; email: string }) {
  const initials = name
    ? name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : email[0].toUpperCase();

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name ?? email}
        className="h-12 w-12 rounded-full object-cover shrink-0"
        onError={(e) => {
          // Fallback to initials on image error
          const parent = e.currentTarget.parentElement as HTMLElement;
          e.currentTarget.style.display = "none";
          parent.querySelector("[data-fallback]")?.removeAttribute("style");
        }}
      />
    );
  }

  return (
    <div
      className="flex h-12 w-12 items-center justify-center rounded-full shrink-0 text-sm font-semibold"
      style={{ background: "var(--color-ink)", color: "#fff" }}
    >
      {initials}
    </div>
  );
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

  const totalPackages = roster.reduce((s, t) => s + t.packageCount, 0);
  const totalStorage = roster.reduce((s, t) => s + (t.totalSizeBytes ?? 0), 0);

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Representative
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>My Roster</h1>
        {!loading && roster.length > 0 && (
          <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
            {roster.length} talent · {totalPackages} ready package{totalPackages !== 1 ? "s" : ""} · {fmt(totalStorage)} total
          </p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
          ))}
        </div>
      ) : roster.length === 0 ? (
        <div
          className="rounded border p-10 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "var(--color-border)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>No talent linked yet</p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
            Ask your talent to add you as a representative from their Account settings.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {roster.map((t) => {
            const displayName = t.fullName ?? t.email;
            const subtitle = t.fullName ? t.email : null;
            return (
              <Link
                key={t.talentId}
                href={`/roster/${t.talentId}`}
                className="group flex items-center gap-5 rounded border px-5 py-4 transition hover:shadow-sm"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <TalentAvatar name={t.fullName} imageUrl={t.profileImageUrl} email={t.email} />
                  {/* Initials fallback (hidden by default when image present) */}
                  {t.profileImageUrl && (
                    <div
                      data-fallback
                      className="absolute inset-0 flex items-center justify-center rounded-full text-sm font-semibold"
                      style={{ display: "none", background: "var(--color-ink)", color: "#fff" }}
                    >
                      {(t.fullName ?? t.email)[0].toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink)" }}>
                      {displayName}
                    </p>
                    {t.tmdbId && (
                      <span
                        className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: "#01b4e418", color: "#01b4e4" }}
                      >
                        TMDB
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>{subtitle}</p>
                  )}
                  <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>
                    Linked {new Date(t.linkedSince * 1000).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                </div>

                {/* Stats */}
                <div className="shrink-0 text-right hidden sm:block">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                    {t.packageCount}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    {t.packageCount === 1 ? "package" : "packages"}
                  </p>
                  {t.totalSizeBytes ? (
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                      {fmt(t.totalSizeBytes)}
                    </p>
                  ) : null}
                </div>

                {/* Arrow */}
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="shrink-0 opacity-30 group-hover:opacity-70 transition"
                  style={{ color: "var(--color-ink)" }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
