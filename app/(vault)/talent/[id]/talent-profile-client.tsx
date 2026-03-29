"use client";

import { useState } from "react";
import Link from "next/link";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";

// ── Types ─────────────────────────────────────────────────────────────────────

type Permission = "allowed" | "approval_required" | "blocked";

interface TalentProfile {
  fullName: string;
  profileImageUrl: string | null;
  tmdbId: number | null;
  knownFor: { title: string; year?: number; type: string }[];
}

interface PermissionRow {
  licenceType: string;
  permission: Permission;
}

interface ScanPackage {
  id: string;
  name: string;
  description: string | null;
  captureDate: number | null;
  studioName: string | null;
  totalSizeBytes: number | null;
  fileCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Permission display ────────────────────────────────────────────────────────

const PERMISSION_META: Record<string, { label: string; description: string }> = {
  commercial:           { label: "Commercial Ads",        description: "TV, digital & out-of-home advertising" },
  film_double:          { label: "Digital Double",         description: "De-aging, stunt replacement in film/TV" },
  game_character:       { label: "Video Game",             description: "In-engine character or NPC" },
  ai_avatar:            { label: "AI Avatar",              description: "Real-time synthetic likeness" },
  training_data:        { label: "Training Datasets",      description: "AI model training inclusion" },
  monitoring_reference: { label: "Deepfake Protection",    description: "Monitoring & reference use" },
};

const PERMISSION_STYLE: Record<Permission, { label: string; color: string; bg: string }> = {
  allowed:          { label: "Allowed",           color: "#166534", bg: "#16653415" },
  approval_required: { label: "Approval required", color: "#92400e", bg: "#92400e15" },
  blocked:          { label: "Blocked",            color: "#991b1b", bg: "#991b1b15" },
};

// ── Package preview panel ─────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  raw: "#2563eb", exr: "#7c3aed", jpeg: "#059669",
  meta: "#9ca3af", mesh: "#d97706", video: "#dc2626",
  "360viewer": "#0891b2", docs: "#6b7280", other: "#9ca3af",
};

function PackagePreview({ packageId }: { packageId: string }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  function load() {
    if (loaded) return;
    setLoading(true);
    fetch(`/api/packages/${packageId}/preview`)
      .then((r) => r.ok ? r.json() as Promise<PreviewResponse> : Promise.reject())
      .then((d) => { setData(d); setLoaded(true); })
      .catch(() => setLoaded(true))
      .finally(() => setLoading(false));
  }

  if (!loaded && !loading) {
    return (
      <button
        onClick={load}
        className="mt-4 flex items-center gap-1.5 text-xs transition hover:opacity-70"
        style={{ color: "var(--color-muted)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        Load preview
      </button>
    );
  }

  if (loading) return <p className="mt-4 text-xs" style={{ color: "var(--color-muted)" }}>Loading preview…</p>;
  if (!data) return <p className="mt-4 text-xs" style={{ color: "var(--color-muted)" }}>Preview unavailable.</p>;

  const maxBar = Math.max(...data.stats.map((s) => s.totalBytes), 1);

  return (
    <div className="mt-4 pt-4 border-t space-y-4" style={{ borderColor: "var(--color-border)" }}>
      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {data.images.map((img, i) => (
              <div key={i} className="overflow-hidden rounded" style={{ aspectRatio: "3/4", background: "var(--color-border)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.filename} loading="lazy" className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.mp4Url && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>360° Reference</p>
          {videoOpen
            ? <video src={data.mp4Url} controls autoPlay loop className="w-full rounded" style={{ maxHeight: 200, background: "#000" }} />
            : (
              <button onClick={() => setVideoOpen(true)}
                className="flex items-center gap-2 rounded border px-3 py-2 text-xs transition hover:opacity-70"
                style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
                </svg>
                Play 360° reference
              </button>
            )}
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
          Contents — {data.totalFiles} files · {formatBytes(data.totalSizeBytes)}
        </p>
        <div className="space-y-2">
          {data.stats.map((s) => {
            const color = CATEGORY_COLORS[s.category] ?? "#9ca3af";
            return (
              <div key={s.category}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>{s.label}</span>
                    <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>{s.count} {s.count === 1 ? "file" : "files"}</span>
                  </div>
                  <span className="text-xs font-mono shrink-0 ml-2" style={{ color: "var(--color-muted)" }}>{formatBytes(s.totalBytes)}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round(s.totalBytes / maxBar * 100)}%`, background: color, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function TalentProfileClient({
  talentId,
  talent,
  profile,
  permissions,
  capabilities,
  packages,
}: {
  talentId: string;
  talent: { id: string; email: string };
  profile: TalentProfile | null;
  permissions: PermissionRow[];
  capabilities: string[];
  packages: ScanPackage[];
}) {
  const [openPreview, setOpenPreview] = useState<string | null>(null);

  const displayName = profile?.fullName ?? talent.email.split("@")[0];
  const initials = displayName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const latestScan = packages[0];

  return (
    <div className="p-8 max-w-4xl">

      {/* Back */}
      <Link href="/directory" className="mb-7 inline-flex items-center gap-1.5 text-xs transition hover:opacity-70" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Directory
      </Link>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="rounded border overflow-hidden mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="p-6 flex items-start gap-6">

          {/* Portrait */}
          <div className="shrink-0">
            {profile?.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.profileImageUrl}
                alt={displayName}
                className="rounded object-cover shadow-sm"
                style={{ width: 88, height: 132 }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded text-2xl font-semibold text-white"
                style={{ width: 88, height: 132, background: "var(--color-ink)" }}
              >
                {initials}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                  {displayName}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {profile?.tmdbId && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                      style={{ background: "rgba(1,180,228,0.12)", color: "#01b4e4" }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      Identity Verified
                    </span>
                  )}
                  <span
                    className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded"
                    style={{ background: "#16653415", color: "#166534" }}
                  >
                    {packages.length} scan{packages.length !== 1 ? "s" : ""} available
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
              {latestScan?.studioName && (
                <div><span className="font-medium" style={{ color: "var(--color-ink)" }}>Scan facility</span><br />{latestScan.studioName}</div>
              )}
              {latestScan?.captureDate && (
                <div><span className="font-medium" style={{ color: "var(--color-ink)" }}>Last captured</span><br />{formatDate(latestScan.captureDate)}</div>
              )}
            </div>

            {/* Known for */}
            {profile?.knownFor && profile.knownFor.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--color-muted)" }}>Known for</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.knownFor.slice(0, 4).map((k, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-sm" style={{ background: "var(--color-border)", color: "var(--color-ink)" }}>
                      <span className="text-[9px] uppercase font-semibold" style={{ color: "var(--color-muted)" }}>
                        {k.type === "movie" ? "Film" : "TV"}
                      </span>
                      {k.title}{k.year ? ` · ${k.year}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Capabilities strip */}
        {capabilities.length > 0 && (
          <div className="border-t px-6 py-4" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2.5" style={{ color: "var(--color-muted)" }}>
              Capabilities
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1.5">
              {capabilities.map((cap) => (
                <div key={cap} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--color-ink)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {cap}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">

        {/* ── Scan packages ──────────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Scan packages
          </p>

          {packages.length === 0 ? (
            <div className="rounded border px-5 py-8 text-center" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>No packages available for licensing.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {packages.map((pkg) => (
                <div key={pkg.id} className="rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
                        {pkg.description && (
                          <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>{pkg.description}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
                          <span>{formatDate(pkg.captureDate)}</span>
                          <span>{pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}</span>
                          {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
                            <span>{formatBytes(pkg.totalSizeBytes)}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setOpenPreview(openPreview === pkg.id ? null : pkg.id)}
                          className="p-1.5 rounded transition opacity-40 hover:opacity-100"
                          style={{ color: "var(--color-ink)" }}
                          title="Preview"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        </button>
                        <Link
                          href={`/licences/request/${pkg.id}`}
                          className="rounded px-3.5 py-1.5 text-xs font-medium text-white transition hover:opacity-80"
                          style={{ background: "var(--color-accent)" }}
                        >
                          Request Licence
                        </Link>
                      </div>
                    </div>

                    {openPreview === pkg.id && <PackagePreview packageId={pkg.id} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Permissions sidebar ────────────────────────────────────────── */}
        <div>
          <p className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Licensing permissions
          </p>
          <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {permissions.map((row, i) => {
              const meta = PERMISSION_META[row.licenceType];
              const style = PERMISSION_STYLE[row.permission];
              if (!meta) return null;
              return (
                <div
                  key={row.licenceType}
                  className="px-4 py-3 flex items-start justify-between gap-3"
                  style={{
                    borderBottom: i < permissions.length - 1 ? "1px solid var(--color-border)" : "none",
                    background: "var(--color-surface)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>{meta.label}</p>
                    <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--color-muted)" }}>{meta.description}</p>
                  </div>
                  <span
                    className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {row.permission === "approval_required" ? "On request" : style.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Request licence CTA */}
          {packages.length > 0 && (
            <Link
              href={`/licences/request/${packages[0].id}`}
              className="mt-4 flex items-center justify-center gap-2 w-full rounded px-4 py-3 text-sm font-medium text-white transition hover:opacity-80"
              style={{ background: "var(--color-accent)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              Request a Licence
            </Link>
          )}
        </div>

      </div>
    </div>
  );
}
