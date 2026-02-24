"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// This page shows licences in awaiting_talent state — talent needs to click through to authorise
interface PendingAuth {
  licenceId: string;
  projectName: string;
  productionCompany: string;
  packageId: string;
  initiatedAt: number;
  expiresAt: number;
}

export default function AuthoriseListClient() {
  const [pending, setPending] = useState<PendingAuth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all approved licences and check KV status for each
    // For simplicity, we fetch approved licences and let the talent navigate to each
    fetch("/api/licences?status=APPROVED")
      .then((r) => r.json() as Promise<{ licences?: Array<{ id: string; projectName: string; productionCompany: string; packageId: string }> }>)
      .then(async (d) => {
        const licences = d.licences ?? [];
        // Poll status for each approved licence to find those awaiting talent
        const results = await Promise.all(
          licences.map(async (l: { id: string; projectName: string; productionCompany: string; packageId: string }) => {
            const r = await fetch(`/api/licences/${l.id}/download/status`);
            const s = await r.json() as { step?: string | null };
            if (s.step === "awaiting_talent") {
              return {
                licenceId: l.id,
                projectName: l.projectName,
                productionCompany: l.productionCompany,
                packageId: l.packageId,
                initiatedAt: 0,
                expiresAt: 0,
              } as PendingAuth;
            }
            return null;
          })
        );
        setPending(results.filter(Boolean) as PendingAuth[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Pending Authorisations
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Production companies awaiting your 2FA approval to download scan packages.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Checking for pending authorisations…</p>}

      {!loading && pending.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No pending authorisations.</p>
      )}

      <div className="space-y-3">
        {pending.map((p) => (
          <div
            key={p.licenceId}
            className="rounded border p-5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>{p.projectName}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{p.productionCompany}</p>
                <div
                  className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                  Awaiting your approval
                </div>
              </div>
              <Link
                href={`/vault/authorise/${p.licenceId}`}
                className="flex-shrink-0 rounded px-4 py-2 text-xs font-medium text-white transition"
                style={{ background: "var(--color-accent)" }}
              >
                Authorise
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
