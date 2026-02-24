"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Licence {
  id: string;
  packageName: string | null;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  status: string;
  createdAt: number;
  licenseeId: string;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RequestsClient() {
  const [requests, setRequests] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denyingId, setDenyingId] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/licences?status=PENDING");
    const d = await r.json();
    setRequests(d.licences ?? []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  async function approve(id: string) {
    setActionId(id);
    await fetch(`/api/licences/${id}/approve`, { method: "POST" });
    await load();
    setActionId(null);
  }

  async function deny(id: string) {
    setActionId(id);
    await fetch(`/api/licences/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: denyReason }),
    });
    setDenyingId(null);
    setDenyReason("");
    await load();
    setActionId(null);
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Incoming Requests
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Review and approve or deny licence requests from production companies.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}

      {!loading && requests.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No pending requests.</p>
      )}

      <div className="space-y-4">
        {requests.map((r) => (
          <div
            key={r.id}
            className="rounded border p-5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                  {r.projectName}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {r.productionCompany} · Package: {r.packageName ?? "—"}
                </p>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--color-text)" }}>
                  {r.intendedUse}
                </p>
                <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
                  Licence period: {formatDate(r.validFrom)} – {formatDate(r.validTo)} · Received {formatDate(r.createdAt)}
                </p>
              </div>
            </div>

            {denyingId === r.id ? (
              <div className="mt-4 space-y-2">
                <input
                  type="text"
                  value={denyReason}
                  onChange={(e) => setDenyReason(e.target.value)}
                  placeholder="Reason for denial (optional)"
                  className="w-full rounded border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => deny(r.id)}
                    disabled={actionId === r.id}
                    className="rounded px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
                    style={{ background: "var(--color-danger)" }}
                  >
                    Confirm Deny
                  </button>
                  <button
                    onClick={() => { setDenyingId(null); setDenyReason(""); }}
                    className="rounded px-4 py-2 text-xs font-medium"
                    style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => approve(r.id)}
                  disabled={actionId === r.id}
                  className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60"
                  style={{ background: "var(--color-accent)" }}
                >
                  {actionId === r.id ? "Processing…" : "Approve"}
                </button>
                <button
                  onClick={() => setDenyingId(r.id)}
                  disabled={actionId === r.id}
                  className="rounded border px-4 py-2 text-xs font-medium transition"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
