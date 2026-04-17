"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LicenceStatus = "AWAITING_PACKAGE" | "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";

interface Licence {
  id: string;
  packageName: string | null;
  packageScanType: string | null;
  packageTags: string | null;
  packageHasMesh: boolean | null;
  packageHasTexture: boolean | null;
  packageHasHdr: boolean | null;
  packageHasMotionCapture: boolean | null;
  talentEmail: string | null;
  talentName: string | null;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  status: LicenceStatus;
  approvedAt: number | null;
  deniedAt: number | null;
  deniedReason: string | null;
  downloadCount: number;
  lastDownloadAt: number | null;
  createdAt: number;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  permitAiTraining: boolean;
  proposedFee: number | null;
  agreedFee: number | null;
}

const TABS: { label: string; value: LicenceStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Denied", value: "DENIED" },
];

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  AWAITING_PACKAGE: "#7c3aed",
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
};

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI Training Data",
  monitoring_reference: "Identity / Security Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

const SCAN_TYPE_LABELS: Record<string, string> = {
  light_stage: "Light Stage",
  photogrammetry: "Photogrammetry",
  lidar: "LiDAR",
  structured_light: "Structured Light",
  other: "Other",
};

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtGBP(pence: number) {
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

export default function LicencesClient() {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [tab, setTab] = useState<LicenceStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const url = tab === "ALL" ? "/api/licences" : `/api/licences?status=${tab}`;
    fetch(url)
      .then((r) => r.json() as Promise<{ licences?: Licence[] }>)
      .then((d) => setLicences(d.licences ?? []))
      .catch(() => setError("Failed to load licences"))
      .finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            My Licences
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Track your licence requests and download approved scan packages.
          </p>
        </div>
        <Link
          href="/directory"
          className="flex-shrink-0 rounded px-4 py-2 text-xs font-medium text-white transition"
          style={{ background: "var(--color-accent)" }}
        >
          Browse Directory
        </Link>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="px-4 py-2 text-sm transition relative"
            style={{
              color: tab === t.value ? "var(--color-ink)" : "var(--color-muted)",
              fontWeight: tab === t.value ? 600 : 400,
            }}
          >
            {t.label}
            {tab === t.value && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
      {!loading && !error && licences.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No licences found.{tab !== "DENIED" && (
            <>{" "}<Link href="/directory" className="underline">Browse the directory</Link> to request one.</>
          )}
        </p>
      )}

      <div className="space-y-3">
        {licences.map((l) => {
          const expanded = expandedId === l.id;
          const feeRef = l.agreedFee ?? l.proposedFee;

          return (
            <div
              key={l.id}
              className="rounded border"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="p-5">
                {/* ── Summary row ──────────────────────────────────────────── */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                        {l.projectName}
                      </p>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: `${STATUS_COLOURS[l.status]}18`,
                          color: STATUS_COLOURS[l.status],
                        }}
                      >
                        {l.status}
                      </span>
                      {l.licenceType && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          {LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
                      {l.talentName ?? l.talentEmail ?? "—"} · {l.productionCompany} · {l.packageName ?? "Unknown package"}
                    </p>
                    {/* Package metadata chips */}
                    {(() => {
                      const tags: string[] = (() => { try { return l.packageTags ? JSON.parse(l.packageTags) as string[] : []; } catch { return []; } })();
                      const caps: string[] = [
                        l.packageHasMesh && "Mesh",
                        l.packageHasTexture && "Textures",
                        l.packageHasHdr && "HDR",
                        l.packageHasMotionCapture && "MoCap",
                      ].filter(Boolean) as string[];
                      if (!l.packageScanType && caps.length === 0 && tags.length === 0) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {l.packageScanType && (
                            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-sm"
                              style={{ background: "var(--color-accent)", color: "#fff", opacity: 0.85 }}>
                              {SCAN_TYPE_LABELS[l.packageScanType] ?? l.packageScanType}
                            </span>
                          )}
                          {caps.map((cap) => (
                            <span key={cap} className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-sm"
                              style={{ background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                              {cap}
                            </span>
                          ))}
                          {tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-sm"
                              style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                    <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                      Licence period: {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                    </p>
                    {feeRef && (
                      <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                        {l.agreedFee ? "Agreed fee" : "Proposed fee"}: {fmtGBP(feeRef)}
                      </p>
                    )}
                    {l.deniedReason && (
                      <p className="mt-1 text-xs" style={{ color: "var(--color-danger)" }}>
                        Reason: {l.deniedReason}
                      </p>
                    )}
                    {l.downloadCount > 0 && (
                      <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                        {l.downloadCount} download{l.downloadCount !== 1 ? "s" : ""} · Last: {formatDate(l.lastDownloadAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : l.id)}
                      className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                    >
                      Details
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {l.status === "APPROVED" && (
                      <a
                        href={`/api/licences/${l.id}/contract`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border px-3 py-1.5 text-xs font-medium transition"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                      >
                        Contract
                      </a>
                    )}
                    {l.status === "APPROVED" && (
                      <Link
                        href={`/licences/${l.id}/download`}
                        className="rounded px-4 py-2 text-xs font-medium text-white transition"
                        style={{ background: "var(--color-accent)" }}
                      >
                        Download
                      </Link>
                    )}
                  </div>
                </div>

                {/* ── Expanded details ──────────────────────────────────────── */}
                {expanded && (
                  <div
                    className="mt-4 rounded border divide-y text-xs"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {[
                      l.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType] : null,
                      l.territory ? ["Territory", l.territory] : null,
                      l.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[l.exclusivity] ?? l.exclusivity] : null,
                      ["AI processing", l.permitAiTraining ? "Requested" : "Not requested"],
                      l.approvedAt ? ["Approved", formatDate(l.approvedAt)] : null,
                      l.deniedAt ? ["Denied", formatDate(l.deniedAt)] : null,
                    ]
                      .filter((row): row is [string, string] => row !== null)
                      .map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-4 px-3 py-2">
                          <span style={{ color: "var(--color-muted)" }}>{key}</span>
                          <span
                            className="font-medium text-right"
                            style={{
                              color: key === "AI processing" && l.permitAiTraining ? "#b45309" : "var(--color-ink)",
                            }}
                          >
                            {value}
                          </span>
                        </div>
                      ))}

                    <div className="px-3 py-3">
                      <p className="mb-1" style={{ color: "var(--color-muted)" }}>Intended use</p>
                      <p className="leading-relaxed" style={{ color: "var(--color-ink)" }}>{l.intendedUse}</p>
                    </div>

                    {feeRef && (
                      <div className="px-3 py-3 space-y-1">
                        <p className="mb-2 font-medium" style={{ color: "var(--color-ink)" }}>Fee</p>
                        <div className="flex justify-between">
                          <span style={{ color: "var(--color-muted)" }}>{l.agreedFee ? "Agreed fee" : "Proposed fee"}</span>
                          <span style={{ color: "var(--color-ink)" }}>{fmtGBP(feeRef)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
