"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface WatchAccount {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  hitCount: number;
  cumulativeViews: number;
  talentAffectedCount: number;
  status: string;
  notes: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface ImportedAccount {
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  verified: boolean;
}

const PLATFORMS = ["instagram", "tiktok", "youtube", "x"];

/** The list runs to thousands of curated handles once a few imports have gone
 *  through, so it pages rather than rendering the lot. */
const PAGE_SIZE = 50;

function compact(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function WatchlistClient() {
  const [accounts, setAccounts] = useState<WatchAccount[]>([]);
  const [platform, setPlatform] = useState("instagram");
  const [pasteText, setPasteText] = useState("");
  const [curationHandle, setCurationHandle] = useState("");
  const [imported, setImported] = useState<ImportedAccount[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/accounts");
    if (!res.ok) return;
    const data = (await res.json()) as { accounts: WatchAccount[] };
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addHandles = useCallback(
    async (payload: { text?: string; handles?: string[] }) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, ...payload }),
        });
        const data = (await res.json()) as {
          added?: number;
          skipped?: number;
          rejected?: string[];
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Add failed");
          return;
        }
        const bits = [`${data.added} added`];
        if (data.skipped) bits.push(`${data.skipped} already on the list`);
        if (data.rejected?.length) bits.push(`${data.rejected.length} unparseable`);
        setMessage(bits.join(" · "));
        setPasteText("");
        setImported(null);
        setSelected(new Set());
        await load();
      } finally {
        setBusy(false);
      }
    },
    [platform, load]
  );

  const importFollows = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setImported(null);
    try {
      const res = await fetch("/api/admin/monitor/accounts/import-follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: curationHandle }),
      });
      const data = (await res.json()) as { accounts?: ImportedAccount[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }
      setImported(data.accounts ?? []);
      setSelected(new Set((data.accounts ?? []).map((a) => a.handle)));
    } finally {
      setBusy(false);
    }
  }, [curationHandle]);

  const verify = useCallback(
    async (prune: boolean) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/accounts/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: "instagram", prune }),
        });
        const data = (await res.json()) as {
          checked?: number;
          enriched?: number;
          missing?: string[];
          pruned?: number;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Verify failed");
          return;
        }
        const bits = [`${data.checked} checked`, `${data.enriched} enriched`];
        if (data.missing?.length) bits.push(`${data.missing.length} do not exist: @${data.missing.join(", @")}`);
        if (data.pruned) bits.push(`${data.pruned} removed`);
        setMessage(bits.join(" · "));
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/admin/monitor/accounts?id=${id}`, { method: "DELETE" });
        const data = (await res.json()) as { action?: string; reason?: string };
        if (res.ok) {
          setMessage(data.action === "cleared" ? `Marked cleared — ${data.reason}` : "Removed");
          await load();
        }
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const watchlist = accounts.filter((a) => a.status === "watchlist");
  const withHits = accounts.filter((a) => a.hitCount > 0);

  // Biggest reach first — that is the order the list is worked in. Accounts
  // with no recorded hits have no view count yet, so follower count breaks the
  // tie and keeps freshly imported handles ranked sensibly against each other.
  const [page, setPage] = useState(0);
  const sorted = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          b.cumulativeViews - a.cumulativeViews ||
          (b.followerCount ?? 0) - (a.followerCount ?? 0) ||
          a.handle.localeCompare(b.handle)
      ),
    [accounts]
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    // A prune (or a filter change) can drop the page out from under us.
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>
          Watched accounts
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Accounts re-harvested on every sweep. Their posts are name-matched against the whole roster,
          so one harvest covers every monitored talent. A curated entry carries no hits until a sweep
          records one, and talent only see accounts that have hit them.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Platform
        </label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded border px-3 py-1.5 text-sm"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
          }}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* ── Import from a curation account ── */}
      <div
        className="rounded-md border p-5 space-y-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Import from a curation account
        </h3>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Follow offending accounts from a dedicated Instagram account, then import that account&rsquo;s
          follows here. Nothing is written until you confirm the list below.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={curationHandle}
            onChange={(e) => setCurationHandle(e.target.value)}
            placeholder="@imagevault.watch"
            className="flex-1 min-w-[220px] rounded border px-3 py-2 text-sm font-mono"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
          <button
            onClick={importFollows}
            disabled={busy || !curationHandle.trim()}
            className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
            style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
          >
            Fetch follows
          </button>
        </div>

        {imported && imported.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                {selected.size} of {imported.length} selected
              </p>
              <button
                onClick={() =>
                  setSelected(
                    selected.size === imported.length ? new Set() : new Set(imported.map((a) => a.handle))
                  )
                }
                className="text-xs underline underline-offset-2"
                style={{ color: "var(--color-muted)" }}
              >
                {selected.size === imported.length ? "Select none" : "Select all"}
              </button>
            </div>
            <div
              className="max-h-64 overflow-y-auto rounded border"
              style={{ borderColor: "var(--color-border)" }}
            >
              {imported.map((a) => (
                <label
                  key={a.handle}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                  style={{ borderTop: "1px solid var(--color-border)" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(a.handle)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(a.handle);
                      else next.delete(a.handle);
                      setSelected(next);
                    }}
                  />
                  <span className="font-mono text-xs" style={{ color: "var(--color-ink)" }}>
                    @{a.handle}
                  </span>
                  {a.displayName && (
                    <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                      {a.displayName}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-mono" style={{ color: "var(--color-muted)" }}>
                    {compact(a.followerCount)}
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={() => addHandles({ handles: [...selected] })}
              disabled={busy || selected.size === 0}
              className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              style={{ background: "var(--color-accent)", borderRadius: "var(--radius)" }}
            >
              Add {selected.size} to watchlist
            </button>
          </div>
        )}
      </div>

      {/* ── Paste ── */}
      <div
        className="rounded-md border p-5 space-y-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Add to watchlist
        </h3>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          One per line, or comma-separated. Accepts <code>@handle</code>, bare handles, or full profile
          URLs. Re-running the same paste is safe: existing entries are skipped rather than duplicated.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={5}
          placeholder={"leakingai\n@reveal.aii\nhttps://www.instagram.com/ultimatestudiosofficial/"}
          className="w-full rounded border px-3 py-2 text-sm font-mono"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
            color: "var(--color-ink)",
          }}
        />
        <button
          onClick={() => addHandles({ text: pasteText })}
          disabled={busy || !pasteText.trim()}
          className="px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
          style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
        >
          Add to watchlist
        </button>
      </div>

      {message && (
        <p className="text-xs" style={{ color: "#16a34a" }}>
          {message}
        </p>
      )}
      {error && (
        <p className="text-xs" style={{ color: "#dc2626" }}>
          {error}
        </p>
      )}

      {/* ── Current list ── */}
      <div>
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            On watch — {watchlist.length} account{watchlist.length === 1 ? "" : "s"}
            {withHits.length > 0 && ` · ${withHits.length} with recorded hits`}
          </h3>
          <div className="flex items-center gap-3">
            {/* A handle that does not exist is swept every cycle for nothing and
                quietly implies coverage we do not have. One batched run finds them. */}
            <button
              onClick={() => verify(false)}
              disabled={busy}
              className="text-xs font-medium underline underline-offset-2 disabled:opacity-50"
              style={{ color: "var(--color-muted)" }}
            >
              Verify &amp; enrich
            </button>
            <button
              onClick={() => verify(true)}
              disabled={busy}
              className="text-xs font-medium underline underline-offset-2 disabled:opacity-50"
              style={{ color: "var(--color-muted)" }}
            >
              Verify &amp; prune dead
            </button>
          </div>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Nothing on the watchlist yet.
          </p>
        ) : (
          <div
            className="rounded-md border overflow-x-auto"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Handle", "Platform", "Hits", "Reach", "Followers", "Talent", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-medium tracking-widest uppercase"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-ink)" }}>
                      @{a.handle}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                      {a.platform}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {a.hitCount}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {compact(a.cumulativeViews)}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-muted)" }}>
                      {compact(a.followerCount)}
                    </td>
                    <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                      {a.talentAffectedCount || "—"}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                      {a.status}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => remove(a.id)}
                        disabled={busy}
                        className="text-xs underline underline-offset-2 disabled:opacity-50"
                        style={{ color: "var(--color-muted)" }}
                      >
                        {a.hitCount > 0 ? "Clear" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pageCount > 1 && (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <p style={{ color: "var(--color-muted)" }}>
                  {page * PAGE_SIZE + 1}&ndash;{Math.min(sorted.length, (page + 1) * PAGE_SIZE)} of{" "}
                  {sorted.length}, by reach
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="underline underline-offset-2 disabled:opacity-40"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Previous
                  </button>
                  <span style={{ color: "var(--color-muted)" }}>
                    {page + 1} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="underline underline-offset-2 disabled:opacity-40"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
