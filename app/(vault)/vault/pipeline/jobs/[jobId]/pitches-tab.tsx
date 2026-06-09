"use client";

import { useEffect, useRef, useState } from "react";

const TONES = ["dramatic", "thriller", "period", "sci-fi", "comedy", "action", "commercial"] as const;
type Tone = (typeof TONES)[number];

interface Vignette {
  id: string;
  productionName: string;
  characterDescription: string;
  tone: string;
  status: string;
  generatedPrompt: string | null;
  error_text: string | null;
  createdAt: number;
  completedAt: number | null;
  output_r2_key: string | null;
}

interface PitchesTabProps {
  packageId: string;
  talentId: string;
  sessionRole: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "#9ca3af",
  prompt_crafting: "#d97706",
  submitting: "#d97706",
  generating: "#2563eb",
  complete: "#166534",
  failed: "#991b1b",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  prompt_crafting: "Crafting prompt…",
  submitting: "Submitting to Higgsfield…",
  generating: "Generating video…",
  complete: "Ready",
  failed: "Failed",
};

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function isActive(status: string): boolean {
  return ["pending", "prompt_crafting", "submitting", "generating"].includes(status);
}

export default function PitchesTab({ packageId, talentId, sessionRole }: PitchesTabProps) {
  const [vignettes, setVignettes] = useState<Vignette[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productionName, setProductionName] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [tone, setTone] = useState<Tone>("dramatic");
  const [includeAudio, setIncludeAudio] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRep = sessionRole === "rep" || sessionRole === "admin";

  async function loadVignettes() {
    try {
      const res = await fetch(`/api/pitch?packageId=${packageId}`);
      if (!res.ok) return;
      const data = await res.json() as { vignettes: Vignette[] };
      setVignettes(data.vignettes);
      setLoading(false);

      const anyActive = data.vignettes.some((v) => isActive(v.status));
      if (!anyActive && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVignettes();
    intervalRef.current = setInterval(loadVignettes, 6000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, productionName, characterDescription, tone, includeAudio, sourceImageKeys: [] }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to queue vignette");
        return;
      }
      setShowForm(false);
      setProductionName("");
      setCharacterDescription("");
      setTone("dramatic");
      await loadVignettes();
      // Restart polling
      if (!intervalRef.current) {
        intervalRef.current = setInterval(loadVignettes, 6000);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this pitch vignette?")) return;
    await fetch(`/api/pitch/${id}`, { method: "DELETE" });
    setVignettes((v) => v.filter((x) => x.id !== id));
  }

  if (loading) {
    return <p className="text-sm py-4" style={{ color: "var(--color-muted)" }}>Loading pitches…</p>;
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
          Pitch Vignettes
        </h2>
        {isRep && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded font-medium text-white transition hover:opacity-90"
            style={{ background: "var(--color-accent)" }}
          >
            + New Pitch
          </button>
        )}
      </div>

      {/* Generation form */}
      {showForm && isRep && (
        <form
          onSubmit={handleGenerate}
          className="mb-6 rounded border p-4 space-y-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Generate AI Pitch Vignette
          </p>

          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Production</label>
            <input
              required
              value={productionName}
              onChange={(e) => setProductionName(e.target.value)}
              placeholder="e.g. The Crown — Season 7"
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Character description</label>
            <textarea
              required
              rows={3}
              value={characterDescription}
              onChange={(e) => setCharacterDescription(e.target.value)}
              placeholder="e.g. Lady Edith, late 40s, British aristocrat, emotionally reserved, conflicted"
              className="w-full rounded border px-3 py-2 text-sm resize-none"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-32">
              <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
                className="w-full rounded border px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end pb-1 gap-2">
              <input
                type="checkbox"
                id="includeAudio"
                checked={includeAudio}
                onChange={(e) => setIncludeAudio(e.target.checked)}
                className="h-4 w-4 rounded"
                style={{ accentColor: "var(--color-accent)" }}
              />
              <label htmlFor="includeAudio" className="text-xs" style={{ color: "var(--color-muted)" }}>
                Include audio
              </label>
            </div>
          </div>

          {error && (
            <p className="text-xs" style={{ color: "#991b1b" }}>{error}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-xs px-3 py-1.5 rounded border"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--color-accent)" }}
            >
              {submitting ? "Queuing…" : "Generate"}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {vignettes.length === 0 && !showForm && (
        <div
          className="rounded border px-4 py-6 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No pitch vignettes yet.
          </p>
          {isRep && (
            <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
              Generate one to showcase this talent for a specific role.
            </p>
          )}
        </div>
      )}

      {/* Vignette cards */}
      <div className="space-y-3">
        {vignettes.map((v) => {
          const color = STATUS_COLOR[v.status] ?? "#9ca3af";
          const active = isActive(v.status);

          return (
            <div
              key={v.id}
              className="rounded border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {v.productionName}
                    </p>
                    <span
                      className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: `${color}18`, color }}
                    >
                      {STATUS_LABEL[v.status] ?? v.status}
                    </span>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                    >
                      {v.tone}
                    </span>
                  </div>
                  <p className="text-xs line-clamp-2" style={{ color: "var(--color-muted)" }}>
                    {v.characterDescription}
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-muted)" }}>
                    {ts(v.createdAt)}
                    {v.completedAt ? ` · Completed ${ts(v.completedAt)}` : ""}
                  </p>
                </div>

                {isRep && (
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="text-[10px] shrink-0 mt-0.5"
                    style={{ color: "var(--color-muted)" }}
                    aria-label="Delete vignette"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Generating progress */}
              {active && (
                <div className="mt-3">
                  <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div
                      className="h-full rounded-full animate-pulse"
                      style={{ width: "60%", background: color }}
                    />
                  </div>
                </div>
              )}

              {/* Error */}
              {v.status === "failed" && v.error_text && (
                <p className="mt-2 text-xs" style={{ color: "#991b1b" }}>{v.error_text}</p>
              )}

              {/* Video player */}
              {v.status === "complete" && (
                <div className="mt-3">
                  <video
                    src={`/api/pitch/${v.id}/stream`}
                    controls
                    className="w-full rounded"
                    style={{ maxHeight: 320, background: "#000" }}
                  />
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <a
                      href={`/api/pitch/${v.id}/stream`}
                      download={`${v.productionName.replace(/[^a-z0-9]/gi, "_")}_vignette.mp4`}
                      className="text-xs px-3 py-1.5 rounded border font-medium transition hover:opacity-80"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                    >
                      Download
                    </a>
                  </div>
                </div>
              )}

              {/* Generated prompt (collapsible) */}
              {v.generatedPrompt && (
                <details className="mt-2">
                  <summary className="text-[10px] cursor-pointer" style={{ color: "var(--color-muted)" }}>
                    View AI prompt
                  </summary>
                  <p className="mt-1 text-[11px] italic" style={{ color: "var(--color-muted)" }}>
                    {v.generatedPrompt}
                  </p>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
