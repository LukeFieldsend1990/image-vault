"use client";

import { useEffect, useState } from "react";

type LicenceStatus = "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED";

interface Licence {
  id: string;
  packageName: string | null;
  projectName: string;
  productionCompany: string;
  validFrom: number;
  validTo: number;
  status: LicenceStatus;
  approvedAt: number | null;
  downloadCount: number;
  lastDownloadAt: number | null;
  createdAt: number;
}

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

export default function TalentLicencesClient() {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/licences");
    const d = await r.json() as { licences?: Licence[] };
    setLicences((d.licences ?? []).filter((l) => l.status !== "PENDING"));
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function revoke(id: string) {
    if (!confirm("Revoke this licence? Any pending downloads will be cancelled.")) return;
    setRevokingId(id);
    await fetch(`/api/licences/${id}/revoke`, { method: "POST" });
    await load();
    setRevokingId(null);
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Granted Licences
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Licences you have approved, denied, or revoked.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
      {!loading && licences.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No licences yet.</p>
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
                  {l.productionCompany} · {l.packageName ?? "—"}
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                  Period: {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                </p>
                {l.downloadCount > 0 && (
                  <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                    Downloaded {l.downloadCount}× · Last: {formatDate(l.lastDownloadAt)}
                  </p>
                )}
              </div>

              {l.status === "APPROVED" && (
                <button
                  onClick={() => revoke(l.id)}
                  disabled={revokingId === l.id}
                  className="flex-shrink-0 rounded border px-3 py-1.5 text-xs transition disabled:opacity-60"
                  style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
                >
                  {revokingId === l.id ? "Revoking…" : "Revoke"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
