"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// ── types (mirror lib/compliance/watchlist.ts) ────────────────────────────────

interface WatchlistEntry {
  id: string;
  name: string;
  companyName: string | null;
  tmdbId: number | null;
  type: string | null;
  expectedStage: string;
  expectedStartDate: number | null;
  source: string;
  notes: string | null;
  flaggedForOutreach: boolean;
  outreachNotes: string | null;
  addedByName: string | null;
  addedAt: number;
  ratified: boolean;
  matchedProductionId: string | null;
  matchedProductionName: string | null;
  matchedStatus: string | null;
}

interface Candidate {
  tmdbId: number;
  name: string;
  type: string;
  releaseDate: string | null;
  year: number | null;
  posterPath: string | null;
  onImageVault: boolean;
  onWatchlist: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  development: "Development", pre_production: "Pre-production", production: "In production", unknown: "Stage unknown",
};
const TYPE_LABELS: Record<string, string> = {
  film: "Feature Film", tv_series: "TV Series", tv_movie: "TV Movie",
  commercial: "Commercial", game: "Game", music_video: "Music Video", other: "Production",
};

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── add panel (TMDB-assisted promotion + manual) ──────────────────────────────

function AddPanel({ onAdded, onClose }: { onAdded: () => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState<number | "manual" | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/watchlist/discover?q=${encodeURIComponent(q)}`);
      const d = (await res.json()) as { results?: Candidate[]; error?: string };
      if (d.error) setError(d.error);
      setCandidates(d.results ?? []);
      setSearched(true);
    } catch {
      setError("Search failed.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  const promote = useCallback(async (c: Candidate) => {
    setBusyId(c.tmdbId);
    setError(null);
    try {
      const res = await fetch("/api/compliance/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, tmdbId: c.tmdbId, type: c.type, source: "tmdb" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to add.");
      } else {
        setCandidates((prev) => prev.map((x) => (x.tmdbId === c.tmdbId ? { ...x, onWatchlist: true } : x)));
        onAdded();
      }
    } finally {
      setBusyId(null);
    }
  }, [onAdded]);

  const addManual = useCallback(async () => {
    const name = manualName.trim();
    if (!name) return;
    setBusyId("manual");
    setError(null);
    try {
      const res = await fetch("/api/compliance/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, companyName: manualCompany.trim() || null, source: "manual" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to add.");
      } else {
        setManualName("");
        setManualCompany("");
        onAdded();
      }
    } finally {
      setBusyId(null);
    }
  }, [manualName, manualCompany, onAdded]);

  return (
    <div className="rounded-lg p-4 mb-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Add an upcoming production</p>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--color-muted)", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}>×</button>
      </div>

      {/* TMDB search */}
      <div className="flex items-center gap-2 mb-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search TMDB by title…"
          className="text-sm rounded px-3 py-1.5 flex-1"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
        />
        <button onClick={() => void search()} disabled={searching || query.trim().length < 2}
          className="text-sm rounded px-3 py-1.5 font-medium"
          style={{ background: "var(--color-accent)", color: "#fff", opacity: searching || query.trim().length < 2 ? 0.5 : 1 }}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="text-xs mt-2" style={{ color: "var(--color-accent)" }}>{error}</p>}

      {candidates.length > 0 && (
        <div className="rounded border divide-y mt-3" style={{ borderColor: "var(--color-border)" }}>
          {candidates.map((c) => (
            <div key={c.tmdbId} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>
                  {c.name} {c.year ? <span style={{ color: "var(--color-muted)" }}>({c.year})</span> : null}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>{TYPE_LABELS[c.type] ?? c.type}</p>
              </div>
              {c.onImageVault ? (
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#1a7f37" }}>On Image Vault</span>
              ) : c.onWatchlist ? (
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>On watchlist</span>
              ) : (
                <button onClick={() => void promote(c)} disabled={busyId === c.tmdbId}
                  className="text-xs rounded px-2.5 py-1 font-medium"
                  style={{ border: "1px solid var(--color-accent)", color: "var(--color-accent)", opacity: busyId === c.tmdbId ? 0.5 : 1 }}>
                  {busyId === c.tmdbId ? "Adding…" : "+ Watchlist"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {searched && candidates.length === 0 && !searching && (
        <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>No TMDB matches — add it manually below.</p>
      )}

      {/* Manual add */}
      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Or add manually</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Production name"
            className="text-sm rounded px-3 py-1.5 flex-1 min-w-[160px]" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          <input value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} placeholder="Company (optional)"
            className="text-sm rounded px-3 py-1.5 flex-1 min-w-[160px]" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          <button onClick={() => void addManual()} disabled={busyId === "manual" || !manualName.trim()}
            className="text-sm rounded px-3 py-1.5 font-medium"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-text)", opacity: busyId === "manual" || !manualName.trim() ? 0.5 : 1 }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, onChanged }: { entry: WatchlistEntry; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/compliance/watchlist/${entry.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [entry.id, onChanged]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/compliance/watchlist/${entry.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [entry.id, onChanged]);

  return (
    <div className="rounded-lg p-4" style={{
      border: "1px solid var(--color-border)", background: "var(--color-surface)",
      opacity: busy ? 0.6 : 1,
    }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight truncate flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <span className="truncate">{entry.name}</span>
            {entry.flaggedForOutreach && (
              <span className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                style={{ color: "#b45309", background: "rgba(180,83,9,0.1)", border: "1px solid rgba(180,83,9,0.3)" }}>
                Outreach
              </span>
            )}
          </h2>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
            {entry.companyName ?? "Company unknown"}
            {entry.type ? ` · ${TYPE_LABELS[entry.type] ?? entry.type}` : ""}
            {` · ${STAGE_LABELS[entry.expectedStage] ?? entry.expectedStage}`}
            {entry.expectedStartDate ? ` · expected ${fmtDate(entry.expectedStartDate)}` : ""}
          </p>
        </div>
        <div className="shrink-0">
          {entry.ratified ? (
            entry.matchedProductionId ? (
              <Link href={`/productions/${entry.matchedProductionId}`}
                title={entry.matchedProductionName ? `View “${entry.matchedProductionName}”` : "View production"}
                className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded inline-block"
                style={{ color: "#1a7f37", border: "1px solid #1a7f3744", background: "rgba(26,127,55,0.08)" }}>
                ✓ On Image Vault →
              </Link>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ color: "#1a7f37", border: "1px solid #1a7f3744", background: "rgba(26,127,55,0.08)" }}>
                ✓ On Image Vault
              </span>
            )
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
              style={{ color: "#b45309", border: "1px solid #b4530944", background: "rgba(180,83,9,0.08)" }}>
              ⚠ Not yet ratified
            </span>
          )}
        </div>
      </div>

      {entry.notes && <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>{entry.notes}</p>}

      <div className="flex items-center gap-4 mt-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
        <span>{entry.source === "tmdb" ? "TMDB" : "Manual"}{entry.addedByName ? ` · added by ${entry.addedByName}` : ""}</span>
        <span className="ml-auto flex items-center gap-3">
          {!entry.ratified && (
            <button onClick={() => void patch({ flaggedForOutreach: !entry.flaggedForOutreach })} disabled={busy}
              className="font-semibold uppercase tracking-widest" style={{ color: entry.flaggedForOutreach ? "var(--color-muted)" : "#b45309" }}>
              {entry.flaggedForOutreach ? "Clear outreach" : "Flag for outreach"}
            </button>
          )}
          <button onClick={() => void remove()} disabled={busy}
            className="font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function WatchlistClient() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance/watchlist");
      const d = (await res.json()) as { entries?: WatchlistEntry[]; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `Failed (${res.status})`);
      else setEntries(d.entries ?? []);
    } catch {
      setError("Failed to load watchlist.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = entries
    .filter((e) => (pendingOnly ? !e.ratified : true))
    // Surface freshly-ratified items at the top — they're the ones awaiting a
    // review-and-dismiss now that the production has been registered.
    .sort((a, b) => Number(b.ratified) - Number(a.ratified));
  const pendingCount = entries.filter((e) => !e.ratified).length;
  const ratifiedCount = entries.filter((e) => e.ratified).length;
  const outreachCount = entries.filter((e) => e.flaggedForOutreach && !e.ratified).length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Oversight</p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Production watchlist</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Upcoming productions heading into pre-production that aren&apos;t yet on Image Vault. Onboarding isn&apos;t
          mandated — this is visibility, so the union can ask a production what it&apos;s doing for compliance.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button onClick={() => setAdding((v) => !v)}
          className="text-sm rounded px-3 py-1.5 font-medium"
          style={{ background: "var(--color-accent)", color: "#fff" }}>
          {adding ? "Close" : "+ Add production"}
        </button>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--color-muted)" }}>
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          Not-yet-ratified only{!loading && ` (${pendingCount})`}
        </label>
        {outreachCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded"
            style={{ color: "#b45309", background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.3)" }}>
            {outreachCount} flagged for outreach
          </span>
        )}
        {ratifiedCount > 0 && pendingOnly && (
          <button onClick={() => setPendingOnly(false)}
            className="text-[11px] font-semibold px-2 py-1 rounded"
            style={{ color: "#1a7f37", background: "rgba(26,127,55,0.08)", border: "1px solid #1a7f3744" }}>
            {ratifiedCount} now on Image Vault — review
          </button>
        )}
      </div>

      {adding && <AddPanel onAdded={load} onClose={() => setAdding(false)} />}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg animate-pulse" style={{ height: 92, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg px-6 py-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>Platform-wide access required</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          {entries.length === 0 ? "Nothing on the watchlist yet — add an upcoming production to start tracking it." : "Every tracked production is now on Image Vault. 🎉"}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((e) => <EntryRow key={e.id} entry={e} onChanged={load} />)}
        </div>
      )}
    </div>
  );
}
