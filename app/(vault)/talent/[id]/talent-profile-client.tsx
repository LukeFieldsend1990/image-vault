"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PreviewResponse } from "@/app/api/packages/[id]/preview/route";

interface Package {
  id: string;
  name: string;
  description: string | null;
  captureDate: number | null;
  studioName: string | null;
  totalSizeBytes: number | null;
  fileCount: number;
}

interface TalentProfile {
  id: string;
  email: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Category colour accents ──────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  raw:         "#2563eb",
  exr:         "#7c3aed",
  jpeg:        "#059669",
  meta:        "#9ca3af",
  mesh:        "#d97706",
  video:       "#dc2626",
  "360viewer": "#0891b2",
  docs:        "#6b7280",
  other:       "#9ca3af",
};

// ── Package preview panel ────────────────────────────────────────────────────
function PackagePreview({ packageId }: { packageId: string }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/packages/${packageId}/preview`)
      .then((r) => r.ok ? r.json() as Promise<PreviewResponse> : Promise.reject())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [packageId]);

  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading preview…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Preview unavailable.</p>
      </div>
    );
  }

  const maxBarBytes = Math.max(...data.stats.map((s) => s.totalBytes), 1);

  return (
    <div className="mt-4 pt-4 border-t space-y-5" style={{ borderColor: "var(--color-border)" }}>

      {/* ── JPEG photo grid ─────────────────────────────────────────────────── */}
      {data.images.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Preview images ({data.images.length})
          </p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
            {data.images.map((img, i) => (
              <div
                key={i}
                className="overflow-hidden rounded"
                style={{ aspectRatio: "3/4", background: "var(--color-border)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.filename}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 360° reference video ────────────────────────────────────────────── */}
      {data.mp4Url && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            360° Reference Video
          </p>
          {videoOpen ? (
            <video
              src={data.mp4Url}
              controls
              autoPlay
              loop
              className="w-full rounded"
              style={{ maxHeight: 220, background: "#000" }}
            />
          ) : (
            <button
              onClick={() => setVideoOpen(true)}
              className="flex items-center gap-2 rounded border px-3 py-2 text-xs transition"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              Play 360° reference video
            </button>
          )}
        </div>
      )}

      {/* ── File type breakdown ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
          Contents — {data.totalFiles} files · {formatBytes(data.totalSizeBytes)}
        </p>
        <div className="space-y-2">
          {data.stats.map((s) => {
            const barPct = Math.round((s.totalBytes / maxBarBytes) * 100);
            const color = CATEGORY_COLORS[s.category] ?? "#9ca3af";
            return (
              <div key={s.category}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {s.label}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>
                      {s.count} {s.count === 1 ? "file" : "files"}
                    </span>
                  </div>
                  <span className="text-xs shrink-0 ml-2 font-mono" style={{ color: "var(--color-muted)" }}>
                    {formatBytes(s.totalBytes)}
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barPct}%`, background: color, opacity: 0.7 }}
                  />
                </div>
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {s.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main page component ──────────────────────────────────────────────────────
export default function TalentProfileClient({ talentId }: { talentId: string }) {
  const [talent, setTalent] = useState<TalentProfile | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/talent/${talentId}/packages`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json() as Promise<{ talent: TalentProfile; packages?: Package[] }>;
      })
      .then((d) => {
        setTalent(d.talent);
        setPackages(d.packages ?? []);
      })
      .catch(() => setError("Talent not found"))
      .finally(() => setLoading(false));
  }, [talentId]);

  if (loading) return <div className="p-8 text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div>;
  if (error || !talent) return (
    <div className="p-8">
      <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error ?? "Not found"}</p>
      <Link href="/directory" className="mt-2 block text-sm underline" style={{ color: "var(--color-muted)" }}>← Back to directory</Link>
    </div>
  );

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/directory" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Directory
      </Link>

      <div className="mb-8 flex items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold"
          style={{ background: "var(--color-ink)", color: "#fff" }}
        >
          {talent.email[0].toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>{talent.email}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {packages.length} scan package{packages.length !== 1 ? "s" : ""} available
          </p>
        </div>
      </div>

      {packages.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No packages available for licensing.</p>
      ) : (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--color-muted)" }}>
            Scan Packages
          </h2>
          {packages.map((pkg) => {
            const isPreviewing = previewId === pkg.id;
            return (
              <div
                key={pkg.id}
                className="rounded border"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="p-5">
                  {/* ── Summary row ─────────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
                      {pkg.description && (
                        <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>{pkg.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--color-muted)" }}>
                        {pkg.studioName && <span>Studio: {pkg.studioName}</span>}
                        <span>Captured: {formatDate(pkg.captureDate)}</span>
                        <span>{pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}</span>
                        {pkg.totalSizeBytes && <span>{formatBytes(pkg.totalSizeBytes)}</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewId(isPreviewing ? null : pkg.id)}
                        className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                      >
                        Preview
                        <svg
                          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: isPreviewing ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      <Link
                        href={`/licences/request/${pkg.id}`}
                        className="rounded px-4 py-2 text-xs font-medium text-white transition"
                        style={{ background: "var(--color-accent)" }}
                      >
                        Request Licence
                      </Link>
                    </div>
                  </div>

                  {/* ── Preview panel ───────────────────────────────────── */}
                  {isPreviewing && <PackagePreview packageId={pkg.id} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
