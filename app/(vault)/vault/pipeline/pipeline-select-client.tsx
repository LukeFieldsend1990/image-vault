"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SKU_OPTIONS = [
  {
    id: "preview",
    label: "Preview Bundle",
    description: "JPEG gallery + 360° MP4 + manifests. Lightweight buyer preview.",
  },
  {
    id: "realtime",
    label: "Realtime Package",
    description: "LR/MR mesh OBJ + FBX rig + EXR textures. For games, AR, brand.",
  },
  {
    id: "vfx",
    label: "VFX Package",
    description: "Full HR mesh + all texture passes + FBX + Maya scene + docs.",
  },
] as const;

interface ScanPackage {
  id: string;
  name: string;
  captureDate: number | null;
  studioName: string | null;
  totalSizeBytes: number | null;
  fileCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function PipelineSelectClient({ packages }: { packages: ScanPackage[] }) {
  const router = useRouter();
  const [selectedPkgs, setSelectedPkgs] = useState<Set<string>>(new Set());
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set(["preview", "realtime", "vfx"]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePkg(id: string) {
    setSelectedPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSku(id: string) {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedPkgs.size === 0) { setError("Select at least one scan package."); return; }
    setSubmitting(true);
    setError(null);
    const skus = [...selectedSkus];
    const pkgIds = [...selectedPkgs];

    try {
      // Fire jobs sequentially — navigate to the last one
      let lastJobId = "";
      for (const packageId of pkgIds) {
        const res = await fetch("/api/pipeline/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageId, skus }),
        });
        if (!res.ok) {
          const d = await res.json() as { error?: string };
          throw new Error(d.error ?? "Failed to start pipeline");
        }
        const { jobId } = await res.json() as { jobId: string };
        lastJobId = jobId;
      }
      router.push(`/vault/pipeline/jobs/${lastJobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.2em] font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Digital Double Pipeline
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Start Pipeline</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Select the scan packages to process and the output bundles to generate.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">

        {/* Left — package selection */}
        <div>
          <p className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Select scans ({selectedPkgs.size} selected)
          </p>

          {packages.length === 0 ? (
            <div
              className="rounded border px-5 py-8 text-center"
              style={{ borderColor: "var(--color-border)" }}
            >
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>No ready scan packages found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {packages.map((pkg) => {
                const checked = selectedPkgs.has(pkg.id);
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => togglePkg(pkg.id)}
                    className="w-full text-left rounded border px-4 py-3.5 flex items-start gap-3.5 transition hover:shadow-sm"
                    style={{
                      borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                      background: checked
                        ? "color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))"
                        : "var(--color-surface)",
                      boxShadow: checked ? "0 0 0 1px var(--color-accent)" : undefined,
                    }}
                  >
                    {/* Checkbox */}
                    <span
                      className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded border transition"
                      style={{
                        borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                        background: checked ? "var(--color-accent)" : "transparent",
                      }}
                    >
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </span>

                    {/* Meta */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>{pkg.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px]" style={{ color: "var(--color-muted)" }}>
                        {pkg.studioName && <span>{pkg.studioName}</span>}
                        {pkg.captureDate && <span>{formatDate(pkg.captureDate)}</span>}
                        <span>{pkg.fileCount} file{pkg.fileCount !== 1 ? "s" : ""}</span>
                      </div>
                    </div>

                    {/* Size */}
                    {pkg.totalSizeBytes != null && pkg.totalSizeBytes > 0 && (
                      <span className="shrink-0 text-[11px] font-mono" style={{ color: "var(--color-muted)" }}>
                        {formatBytes(pkg.totalSizeBytes)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — SKU selection + submit */}
        <div className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
              Output bundles
            </p>
            <div className="space-y-2">
              {SKU_OPTIONS.map((sku) => {
                const checked = selectedSkus.has(sku.id);
                return (
                  <button
                    key={sku.id}
                    type="button"
                    onClick={() => toggleSku(sku.id)}
                    className="w-full text-left rounded border px-3.5 py-3 flex items-start gap-3 transition"
                    style={{
                      borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                      background: checked
                        ? "color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))"
                        : "var(--color-surface)",
                    }}
                  >
                    <span
                      className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded border transition"
                      style={{
                        borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                        background: checked ? "var(--color-accent)" : "transparent",
                      }}
                    >
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </span>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--color-ink)" }}>{sku.label}</p>
                      <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "var(--color-muted)" }}>{sku.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedPkgs.size === 0 || selectedSkus.size === 0}
            className="w-full rounded px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {submitting
              ? "Starting…"
              : selectedPkgs.size === 0
                ? "Select a scan to continue"
                : `Start pipeline — ${selectedPkgs.size} scan${selectedPkgs.size !== 1 ? "s" : ""}, ${selectedSkus.size} SKU${selectedSkus.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
