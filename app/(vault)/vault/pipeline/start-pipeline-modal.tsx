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

interface Props {
  packageId: string;
  packageName: string;
  onClose: () => void;
}

export default function StartPipelineModal({ packageId, packageName, onClose }: Props) {
  const router = useRouter();
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set(["preview", "realtime", "vfx"]));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSku(sku: string) {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) {
        if (next.size > 1) next.delete(sku); // must keep at least one
      } else {
        next.add(sku);
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, skus: [...selectedSkus] }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed to start pipeline");
      }
      const { jobId } = await res.json() as { jobId: string };
      router.push(`/vault/pipeline/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow-xl"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: "var(--color-accent)" }}>
                Digital Double Pipeline
              </p>
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {packageName}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 shrink-0 opacity-40 hover:opacity-70 transition"
              style={{ color: "var(--color-ink)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            Select the output bundles to generate. Each SKU is built from the same source package.
          </p>

          <div className="space-y-2">
            {SKU_OPTIONS.map((sku) => {
              const checked = selectedSkus.has(sku.id);
              return (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => toggleSku(sku.id)}
                  className="w-full text-left rounded border px-4 py-3 flex items-start gap-3 transition"
                  style={{
                    borderColor: checked ? "var(--color-accent)" : "var(--color-border)",
                    background: checked ? `color-mix(in srgb, var(--color-accent) 6%, transparent)` : "transparent",
                  }}
                >
                  <span
                    className="mt-0.5 shrink-0 flex h-4 w-4 items-center justify-center rounded border"
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
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>{sku.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-3 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-end gap-3" style={{ borderColor: "var(--color-border)" }}>
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded border transition hover:opacity-80"
            style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="text-xs px-4 py-2 rounded font-medium text-white transition disabled:opacity-50"
            style={{ background: "var(--color-accent)" }}
          >
            {submitting ? "Starting…" : `Start pipeline — ${selectedSkus.size} SKU${selectedSkus.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
