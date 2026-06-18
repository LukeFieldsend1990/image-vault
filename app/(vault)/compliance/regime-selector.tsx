"use client";

import { useEffect, useState } from "react";

// Regimes that are actually populated (have obligations) and so worth offering in
// the picker. gdpr / bipa remain stubs and are intentionally omitted until built.
export const SELECTABLE_REGIMES = [
  { id: "sag_aftra", label: "SAG-AFTRA · Art. 39" },
  { id: "equity", label: "UK Equity" },
] as const;

export type SelectableRegime = (typeof SELECTABLE_REGIMES)[number]["id"];

// Default is unchanged from before the picker existed — SAG-AFTRA. Users can switch
// to Equity (or another regime) and the choice sticks per browser.
const DEFAULT_REGIME: SelectableRegime = "sag_aftra";
const STORAGE_KEY = "compliance-regime";

function isSelectable(value: string | null): value is SelectableRegime {
  return !!value && SELECTABLE_REGIMES.some((r) => r.id === value);
}

/** Regime choice, defaulting to SAG-AFTRA and persisted in localStorage. */
export function useRegime(): [SelectableRegime, (r: SelectableRegime) => void] {
  const [regime, setRegime] = useState<SelectableRegime>(DEFAULT_REGIME);

  // Read the saved choice after mount (not via a lazy initializer) so the first
  // client render matches the server's default and we avoid a hydration mismatch.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isSelectable(saved)) setRegime(saved);
    } catch { /* localStorage unavailable — keep default */ }
  }, []);

  const update = (r: SelectableRegime) => {
    setRegime(r);
    try { localStorage.setItem(STORAGE_KEY, r); } catch { /* ignore */ }
  };

  return [regime, update];
}

/** Append the chosen regime to a dashboard/API URL, preserving any existing query. */
export function withRegime(url: string, regime: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}regime=${encodeURIComponent(regime)}`;
}

export function RegimeSelector({
  value,
  onChange,
  disabled,
}: {
  value: SelectableRegime;
  onChange: (r: SelectableRegime) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted)" }}>
      <span className="uppercase tracking-widest font-semibold">Regime</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SelectableRegime)}
        disabled={disabled}
        className="text-sm rounded px-2 py-1 disabled:opacity-50"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
      >
        {SELECTABLE_REGIMES.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
    </label>
  );
}
