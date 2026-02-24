"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LicenceStatus = "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";

interface Licence {
  id: string;
  packageName: string | null;
  talentEmail: string | null;
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
}

const TABS: { label: string; value: LicenceStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Denied", value: "DENIED" },
];

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
};

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function LicencesClient() {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [tab, setTab] = useState<LicenceStatus | "ALL">("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          No licences found.{" "}
          <Link href="/directory" className="underline">Browse the directory</Link> to request one.
        </p>
      )}

      <div className="space-y-3">
        {licences.map((l) => (
          <div
            key={l.id}
            className="rounded border p-5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
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
                </div>
                <p className="mt-0.5 text-xs" style={{ color: "var(--color-muted)" }}>
                  {l.packageName ?? "Unknown package"} · {l.talentEmail ?? "—"}
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                  Licence period: {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                </p>
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

              {l.status === "APPROVED" && (
                <Link
                  href={`/licences/${l.id}/download`}
                  className="flex-shrink-0 rounded px-4 py-2 text-xs font-medium text-white transition"
                  style={{ background: "var(--color-accent)" }}
                >
                  Download
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
