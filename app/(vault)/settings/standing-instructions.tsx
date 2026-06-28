"use client";

import { useEffect, useState } from "react";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";

type Disposition = "always" | "case_by_case" | "never";

const OPTIONS: { value: Disposition; label: string; hint: string }[] = [
  { value: "always", label: "Always", hint: "Auto-grant — your agent never has to ask" },
  { value: "case_by_case", label: "Ask me", hint: "Route every request to you (or your agent)" },
  { value: "never", label: "Never", hint: "Structurally blocked — no one can grant it" },
];

const DISPOSITION_COLOUR: Record<Disposition, string> = {
  always: "#166534",
  case_by_case: "var(--color-muted)",
  never: "#991b1b",
};

/**
 * Standing-instructions editor. Talent edit their own; an agent can edit a
 * managed performer's by passing their talentId (the API enforces rep access).
 */
export default function StandingInstructions({ talentId, subtitle }: { talentId?: string; subtitle?: string }) {
  const [map, setMap] = useState<Record<string, Disposition>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = talentId ? `?talentId=${encodeURIComponent(talentId)}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/talent/standing-instructions${qs}`);
        const d = (await r.json()) as { instructions?: Record<string, Disposition>; error?: string };
        if (cancelled) return;
        if (!r.ok) { setError(d.error ?? "Could not load standing instructions."); return; }
        setMap(d.instructions ?? {});
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  async function set(categoryId: string, disposition: Disposition) {
    const prev = map[categoryId];
    setMap((m) => ({ ...m, [categoryId]: disposition }));
    setSavingId(categoryId);
    setError(null);
    try {
      const r = await fetch(`/api/talent/standing-instructions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ talentId, updates: { [categoryId]: disposition } }),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        setError(d.error ?? "Could not save.");
        setMap((m) => ({ ...m, [categoryId]: prev ?? "case_by_case" }));
      }
    } catch {
      setError("Network error.");
      setMap((m) => ({ ...m, [categoryId]: prev ?? "case_by_case" }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>Standing Instructions</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
        {subtitle ?? "Set a rule per use category. New requests resolve automatically when every requested use is set to Always (granted) or Never (refused) — anything else comes to you."}
      </p>
      <p className="text-xs mb-4 rounded px-3 py-2" style={{ color: "var(--color-muted)", lineHeight: 1.5, background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
        Your choices for the AI uses — <strong>Digital replica (§39E)</strong> and <strong>Training data for generative AI (§39G)</strong> — also set your public AI-consent posture (red / amber / green) if you publish a consent profile below. Never = Prohibited, Ask me = Permitted with terms, Always = Permitted.
      </p>

      {loading ? (
        <p className="text-sm py-4" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : (
        <div className="space-y-2.5">
          {USE_CATEGORIES.map((c) => {
            const current = map[c.id] ?? "case_by_case";
            return (
              <div key={c.id} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.name}</span>
                  {c.regimeTag && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>{c.regimeTag}</span>}
                  {c.sensitive && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(180,83,9,0.1)", color: "#b45309" }}>sensitive</span>}
                  <span className="ml-auto text-[11px]" style={{ color: DISPOSITION_COLOUR[current] }}>
                    {savingId === c.id ? "Saving…" : OPTIONS.find((o) => o.value === current)?.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {OPTIONS.map((o) => {
                    const active = current === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => set(c.id, o.value)}
                        title={o.hint}
                        className="rounded px-2 py-1.5 text-xs font-medium transition"
                        style={{
                          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                          background: active ? "var(--color-accent)" : "transparent",
                          color: active ? "white" : "var(--color-muted)",
                        }}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-xs mt-3" style={{ color: "var(--color-accent)" }}>{error}</p>}
    </div>
  );
}
