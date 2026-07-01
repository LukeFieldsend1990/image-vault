"use client";

import { useEffect, useState } from "react";

const CATS = [
  { id: "training", name: "Training data for generative AI", tag: "§39G" },
  { id: "replica", name: "Digital replica", tag: "§39E" },
];
const UNIT_TYPES = [
  { v: "per_generation", l: "per generation" },
  { v: "per_1k_inferences", l: "per 1k inferences" },
  { v: "per_frame", l: "per frame" },
  { v: "per_second", l: "per second" },
];

interface Card {
  useCategoryId: string;
  unitType: string;
  unitRatePence: number;
  autoAccept: boolean;
  active: boolean;
}

export default function RslRateCard() {
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Local editable dollar strings, keyed by category.
  const [rate, setRate] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/rsl/rate-card");
        const d = (await r.json()) as { cards?: Card[]; error?: string };
        if (!r.ok) { setError(d.error ?? "Could not load."); return; }
        const map: Record<string, Card> = {};
        const rr: Record<string, string> = {};
        const uu: Record<string, string> = {};
        for (const c of d.cards ?? []) {
          map[c.useCategoryId] = c;
          rr[c.useCategoryId] = (c.unitRatePence / 100).toString();
          uu[c.useCategoryId] = c.unitType;
        }
        setCards(map); setRate(rr); setUnit(uu);
      } catch { setError("Network error."); }
      finally { setLoading(false); }
    })();
  }, []);

  async function save(catId: string, patch: Partial<Card> & { unitRatePence?: number }) {
    setSavingId(catId); setError(null);
    const dollars = parseFloat(rate[catId] ?? "0");
    const unitRatePence = patch.unitRatePence ?? Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);
    const cur = cards[catId];
    try {
      const r = await fetch("/api/rsl/rate-card", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useCategoryId: catId,
          unitType: unit[catId] ?? cur?.unitType ?? "per_generation",
          unitRatePence,
          autoAccept: patch.autoAccept ?? cur?.autoAccept ?? false,
          active: patch.active ?? cur?.active ?? true,
        }),
      });
      const d = (await r.json()) as { card?: Card; error?: string };
      if (!r.ok) { setError(d.error ?? "Could not save."); return; }
      if (d.card) setCards((m) => ({ ...m, [catId]: d.card! }));
    } catch { setError("Network error."); }
    finally { setSavingId(null); }
  }

  return (
    <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
        AI Rate Card
      </h2>
      <p className="text-xs mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
        Set a price for AI use of your likeness. When a rate is set, requests are quoted instantly. Turn on
        <strong> auto-license</strong> and a permitted (green) use is licensed automatically at your price — otherwise
        the request comes to you to approve. Metered earnings appear in your Royalties dashboard.
      </p>

      {loading ? (
        <p className="text-sm py-2" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : (
        <div className="space-y-3">
          {CATS.map((c) => {
            const cur = cards[c.id];
            return (
              <div key={c.id} className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.name}</span>
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>{c.tag}</span>
                  <span className="ml-auto text-[11px]" style={{ color: "var(--color-muted)" }}>{savingId === c.id ? "Saving…" : cur ? "Saved" : "Not set"}</span>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <label className="text-[10px] block mb-1" style={{ color: "var(--color-muted)" }}>Price (USD)</label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm" style={{ color: "var(--color-muted)" }}>$</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={rate[c.id] ?? ""}
                        onChange={(e) => setRate((m) => ({ ...m, [c.id]: e.target.value }))}
                        className="w-24 rounded px-2 py-1.5 text-sm"
                        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] block mb-1" style={{ color: "var(--color-muted)" }}>Unit</label>
                    <select
                      value={unit[c.id] ?? "per_generation"}
                      onChange={(e) => setUnit((m) => ({ ...m, [c.id]: e.target.value }))}
                      className="rounded px-2 py-1.5 text-sm"
                      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                    >
                      {UNIT_TYPES.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={savingId === c.id}
                    onClick={() => save(c.id, {})}
                    className="rounded px-3 py-1.5 text-xs font-medium text-white"
                    style={{ background: "var(--color-accent)" }}
                  >
                    Save
                  </button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-2.5">
                  <input
                    type="checkbox"
                    checked={cur?.autoAccept ?? false}
                    disabled={!cur || savingId === c.id}
                    onChange={(e) => save(c.id, { autoAccept: e.target.checked })}
                  />
                  <span className="text-xs" style={{ color: "var(--color-text)" }}>
                    Auto-license at this rate
                    <span className="block text-[11px]" style={{ color: "var(--color-muted)" }}>
                      Only applies when your posture for this use is Permitted (green). Save a price first.
                    </span>
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-xs mt-3" style={{ color: "var(--color-accent)" }}>{error}</p>}
    </div>
  );
}
