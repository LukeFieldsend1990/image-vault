"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function TalentProfileClient({ talentId }: { talentId: string }) {
  const [talent, setTalent] = useState<TalentProfile | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/talent/${talentId}/packages`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
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
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="rounded border p-5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
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
                    <span>{formatBytes(pkg.totalSizeBytes)}</span>
                  </div>
                </div>
                <Link
                  href={`/licences/request/${pkg.id}`}
                  className="flex-shrink-0 rounded px-4 py-2 text-xs font-medium text-white transition"
                  style={{ background: "var(--color-accent)" }}
                >
                  Request Licence
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
