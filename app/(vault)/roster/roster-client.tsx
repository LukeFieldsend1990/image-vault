"use client";

import { useState, useEffect, useRef } from "react";
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
  pendingLicences?: number;
}

interface Stats {
  totalScans: number;
  activeLicences: number;
  revenueThisQuarterPence: number;
  pendingRequests: number;
  totalRevenuePence: number;
}

interface RevenueLicence {
  id: string;
  talentName: string | null;
  projectName: string | null;
  productionCompany: string | null;
  licenceType: string;
  territory: string | null;
  status: string;
  agreedFee: number | null;
  approvedAt: number | null;
}

interface RevenueSummary {
  grossPence: number;
  agencyPence: number;
  platformPence: number;
  talentPence: number;
  licenceCount: number;
}

function fmt(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return (n / 1e3).toFixed(0) + " KB";
}

function fmtMoney(pence: number): string {
  if (pence === 0) return "£0";
  const pounds = pence / 100;
  if (pounds >= 1_000_000) return `£${(pounds / 1_000_000).toFixed(1)}M`;
  if (pounds >= 1_000) return `£${(pounds / 1_000).toFixed(1)}K`;
  return `£${pounds.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const LICENCE_TYPE_LABELS: Record<string, string> = {
  commercial: "Commercial",
  film_double: "Film Double",
  game_character: "Game Character",
  ai_avatar: "AI Avatar",
  training_data: "Training Data",
  monitoring_reference: "Monitoring Ref",
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  APPROVED: { bg: "#16a34a18", color: "#16a34a", label: "Approved" },
  PENDING: { bg: "#d9770618", color: "#d97706", label: "Pending" },
  REJECTED: { bg: "#dc262618", color: "#dc2626", label: "Rejected" },
  EXPIRED: { bg: "var(--color-border)", color: "var(--color-muted)", label: "Expired" },
};

// ── Stat card ───────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent, loading, onClick, href,
}: {
  label: string; value: string; sub?: string; accent?: boolean; loading?: boolean;
  onClick?: () => void; href?: string;
}) {
  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      {loading ? (
        <div className="h-6 w-16 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
      ) : (
        <>
          <p
            className="text-xl font-semibold leading-none"
            style={{ color: accent ? "var(--color-accent)" : "var(--color-ink)" }}
          >
            {value}
          </p>
          {sub && <p className="text-[11px] mt-1" style={{ color: "var(--color-muted)" }}>{sub}</p>}
        </>
      )}
    </>
  );

  const sharedStyle = {
    borderColor: accent ? "var(--color-accent)" : "var(--color-border)",
    background: accent ? "rgba(var(--color-accent-rgb, 192,57,43), 0.04)" : "var(--color-surface)",
  };

  if (href) {
    return (
      <Link href={href} className="rounded border px-5 py-4 block transition hover:opacity-80 active:opacity-60" style={sharedStyle}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="rounded border px-5 py-4 w-full text-left transition hover:opacity-80 active:opacity-60" style={sharedStyle}>
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded border px-5 py-4" style={sharedStyle}>
      {inner}
    </div>
  );
}

// ── Portrait card ───────────────────────────────────────────────────────────────

function TalentCard({ talent }: { talent: TalentRow }) {
  const [imgError, setImgError] = useState(false);
  const displayName = talent.fullName ?? talent.email;
  const initials = talent.fullName
    ? talent.fullName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : talent.email[0].toUpperCase();
  const hasPending = (talent.pendingLicences ?? 0) > 0;

  return (
    <div
      className="rounded border overflow-hidden flex flex-col"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Portrait + info — tappable, goes to manage page */}
      <Link href={`/roster/${talent.talentId}`} className="flex flex-col flex-1 min-w-0">
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: "3/4", background: "var(--color-border)" }}
        >
          {talent.profileImageUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={talent.profileImageUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-3xl font-bold"
              style={{ background: "var(--color-ink)", color: "#fff" }}
            >
              {initials}
            </div>
          )}

          {/* Pending badge */}
          {hasPending && (
            <div
              className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              {talent.pendingLicences} pending
            </div>
          )}

          {/* TMDB badge */}
          {talent.tmdbId && (
            <div
              className="absolute bottom-2 left-2 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ background: "#01b4e490", color: "#fff" }}
            >
              TMDB
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 px-3 pt-3 pb-2">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--color-ink)" }}>{displayName}</p>
          {talent.fullName && (
            <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-muted)" }}>{talent.email}</p>
          )}
          <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>
            {talent.packageCount} {talent.packageCount === 1 ? "package" : "packages"}
            {talent.totalSizeBytes ? ` · ${fmt(talent.totalSizeBytes)}` : ""}
          </p>
        </div>
      </Link>

      {/* Quick actions */}
      <div
        className="border-t grid grid-cols-2 divide-x"
        style={{ borderColor: "var(--color-border)" }}
      >
        <Link
          href={`/talent/${talent.talentId}`}
          className="py-2.5 text-center text-xs font-medium transition hover:opacity-70"
          style={{ color: "var(--color-muted)" }}
        >
          View Profile
        </Link>
        <Link
          href={`/roster/${talent.talentId}`}
          className="py-2.5 text-center text-xs font-medium transition hover:opacity-70"
          style={{ color: "var(--color-accent)" }}
        >
          Manage
        </Link>
      </div>
    </div>
  );
}

const PAGE_SIZE = 6;

// ── Main component ──────────────────────────────────────────────────────────────

export default function RosterClient() {
  const [activeTab, setActiveTab] = useState<"roster" | "revenue">("roster");
  const [roster, setRoster] = useState<TalentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [revenueLicences, setRevenueLicences] = useState<RevenueLicence[]>([]);
  const [revenueSummary, setRevenueSummary] = useState<RevenueSummary | null>(null);
  const [revenueLoaded, setRevenueLoaded] = useState(false);
  const revenueFetchingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/api/roster").then((r) => r.json() as Promise<{ roster?: TalentRow[] }>),
      fetch("/api/roster/stats").then((r) => r.json() as Promise<Stats>),
    ])
      .then(([rosterData, statsData]) => {
        setRoster(rosterData.roster ?? []);
        setStats(statsData);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setStatsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (activeTab !== "revenue" || revenueLoaded || revenueFetchingRef.current) return;
    revenueFetchingRef.current = true;
    fetch("/api/roster/revenue")
      .then((r) => r.json() as Promise<{ summary: RevenueSummary; licences: RevenueLicence[] }>)
      .then((d) => {
        setRevenueSummary(d.summary ?? null);
        setRevenueLicences(d.licences ?? []);
      })
      .catch(() => {})
      .finally(() => setRevenueLoaded(true));
  }, [activeTab, revenueLoaded]);

  // Derived: show loading spinner while on revenue tab and data not yet loaded
  const revenueLoading = activeTab === "revenue" && !revenueLoaded;

  const totalPending = roster.reduce((s, t) => s + (t.pendingLicences ?? 0), 0);

  const filteredRoster = search.trim()
    ? roster.filter((t) => {
        const q = search.toLowerCase();
        return (
          (t.fullName ?? "").toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q)
        );
      })
    : roster;
  const totalPages = Math.ceil(filteredRoster.length / PAGE_SIZE);
  const pagedRoster = filteredRoster.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Representative
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>My Roster</h1>
        {!loading && roster.length > 0 && (
          <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
            {search.trim() && filteredRoster.length !== roster.length
              ? `${filteredRoster.length} of ${roster.length} talent`
              : `${roster.length} talent`}
          </p>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Active Licences"
          value={stats ? String(stats.activeLicences) : "—"}
          loading={statsLoading}
          onClick={() => setActiveTab("revenue")}
        />
        <StatCard
          label="Revenue This Quarter"
          value={stats ? fmtMoney(stats.revenueThisQuarterPence) : "—"}
          sub={stats ? `${fmtMoney(stats.totalRevenuePence)} lifetime` : undefined}
          accent
          loading={statsLoading}
          onClick={() => setActiveTab("revenue")}
        />
        <StatCard
          label="Pending Requests"
          value={stats ? String(stats.pendingRequests) : "—"}
          sub={stats?.pendingRequests ? "awaiting approval" : "all clear"}
          loading={statsLoading}
          href="/vault/requests"
        />
        <StatCard
          label="Ready Scans"
          value={stats ? String(stats.totalScans) : "—"}
          loading={statsLoading}
          onClick={() => setActiveTab("roster")}
        />
      </div>

      {/* Pending alert strip */}
      {!loading && totalPending > 0 && (
        <div
          className="mb-5 flex items-center gap-3 rounded border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--color-accent)",
            background: "rgba(var(--color-accent-rgb, 192,57,43), 0.04)",
          }}
        >
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {totalPending}
          </div>
          <p style={{ color: "var(--color-ink)" }}>
            <span className="font-medium">
              {totalPending} licence {totalPending === 1 ? "request" : "requests"}
            </span>{" "}
            <span style={{ color: "var(--color-muted)" }}>awaiting approval across your roster.</span>
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6" style={{ borderColor: "var(--color-border)" }}>
        {(["roster", "revenue"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-4 py-2 text-sm font-medium capitalize transition"
            style={{
              color: activeTab === tab ? "var(--color-ink)" : "var(--color-muted)",
              borderBottom: activeTab === tab ? "2px solid var(--color-ink)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab === "revenue" ? "Revenue" : "Roster"}
          </button>
        ))}
      </div>

      {/* ── Roster tab ── */}
      {activeTab === "roster" && (
        loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="rounded border animate-pulse"
                style={{ aspectRatio: "3/5", borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              />
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
          <>
            {/* Search */}
            <div className="mb-4 relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: "var(--color-muted)" }}
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search by name or email…"
                className="w-full rounded border pl-9 pr-4 py-2 text-sm outline-none"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                  color: "var(--color-ink)",
                }}
              />
            </div>

            {/* Grid */}
            {filteredRoster.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: "var(--color-muted)" }}>
                No talent matching &ldquo;{search}&rdquo;
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {pagedRoster.map((t) => <TalentCard key={t.talentId} talent={t} />)}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-30"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Previous
                </button>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Page {page + 1} of {totalPages}
                </p>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-30"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }}
                >
                  Next
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )
      )}

      {/* ── Revenue tab ── */}
      {activeTab === "revenue" && (
        revenueLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-12 rounded border animate-pulse"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Revenue summary cards */}
            {revenueSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard label="Gross Revenue" value={fmtMoney(revenueSummary.grossPence)} />
                <StatCard label="Agency Share" value={fmtMoney(revenueSummary.agencyPence)} accent />
                <StatCard label="Talent Share" value={fmtMoney(revenueSummary.talentPence)} />
                <StatCard label="Platform Share" value={fmtMoney(revenueSummary.platformPence)} />
              </div>
            )}

            {/* Licence table */}
            {revenueLicences.length === 0 ? (
              <div
                className="rounded border p-8 text-center"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <p className="text-sm" style={{ color: "var(--color-muted)" }}>No licences across your roster yet.</p>
              </div>
            ) : (
              <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                      {["Talent", "Project", "Type", "Fee", "Status", "Date"].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-semibold"
                          style={{ color: "var(--color-muted)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {revenueLicences.map((l, i) => {
                      const statusStyle = STATUS_STYLES[l.status] ?? STATUS_STYLES.EXPIRED;
                      return (
                        <tr
                          key={l.id}
                          style={{
                            background: i % 2 === 0 ? "var(--color-background)" : "var(--color-surface)",
                            borderBottom: "1px solid var(--color-border)",
                          }}
                        >
                          <td className="px-4 py-3 font-medium truncate max-w-[120px]" style={{ color: "var(--color-ink)" }}>
                            {l.talentName ?? "—"}
                          </td>
                          <td className="px-4 py-3 truncate max-w-[140px]" style={{ color: "var(--color-ink)" }}>
                            {l.projectName ?? l.productionCompany ?? "—"}
                          </td>
                          <td className="px-4 py-3" style={{ color: "var(--color-muted)" }}>
                            {LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType}
                          </td>
                          <td className="px-4 py-3 font-medium" style={{ color: "var(--color-ink)" }}>
                            {l.agreedFee ? fmtMoney(l.agreedFee) : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                              style={{ background: statusStyle.bg, color: statusStyle.color }}
                            >
                              {statusStyle.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>
                            {l.approvedAt
                              ? new Date(l.approvedAt * 1000).toLocaleDateString("en-GB", {
                                  day: "numeric", month: "short", year: "numeric",
                                })
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
