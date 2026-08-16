"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface LearnedQuery {
  id: string;
  talentId: string;
  talentName: string | null;
  platform: string;
  query: string;
  hitCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;
}

const PAGE_SIZE = 40;

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export default function LearnedQueriesClient() {
  const [queries, setQueries] = useState<LearnedQuery[]>([]);
  const [talent, setTalent] = useState("all");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/monitor/learned-queries");
      if (!res.ok) return;
      const data = (await res.json()) as { queries: LearnedQuery[] };
      setQueries(data.queries);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const talents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of queries) seen.set(q.talentId, q.talentName ?? q.talentId);
    return [...seen.entries()];
  }, [queries]);

  const filtered = useMemo(
    () => (talent === "all" ? queries : queries.filter((q) => q.talentId === talent)),
    [queries, talent]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const toggle = useCallback(
    async (id: string, active: boolean) => {
      setBusy(id);
      try {
        const res = await fetch("/api/admin/monitor/learned-queries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, active }),
        });
        if (res.ok) await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>
          Harvested hashtags
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Hashtags taken from confirmed hits and added to the next sweep&apos;s query set for that talent.
          Hits is how many flagged posts the tag has been seen on, which is the order sweeps use when the
          learned set is capped against Apify budget. Retiring one stops sweeps querying it without
          deleting its history.
        </p>
      </div>

      {talents.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Talent
          </label>
          <select
            value={talent}
            onChange={(e) => {
              setTalent(e.target.value);
              setPage(0);
            }}
            className="rounded border px-3 py-1.5 text-sm"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-ink)",
            }}
          >
            <option value="all">All</option>
            {talents.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {loaded && filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Nothing harvested yet. Tags are mined from hits as sweeps confirm them.
        </p>
      ) : (
        <div
          className="rounded-md border overflow-x-auto"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["Query", "Platform", "Talent", "Hits", "Last seen", "Status", ""].map((h) => (
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
              {visible.map((q) => (
                <tr key={q.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-ink)" }}>
                    {q.query}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                    {q.platform}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                    {q.talentName ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                    {q.hitCount}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                    {formatDate(q.lastSeenAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded px-1.5 py-0.5 font-medium"
                      style={
                        q.active
                          ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                          : { background: "rgba(107,114,128,0.12)", color: "#6b7280" }
                      }
                    >
                      {q.active ? "In use" : "Retired"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => toggle(q.id, !q.active)}
                      disabled={busy === q.id}
                      className="underline underline-offset-2 disabled:opacity-50"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {q.active ? "Retire" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <p style={{ color: "var(--color-muted)" }}>
                {page * PAGE_SIZE + 1}&ndash;{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of{" "}
                {filtered.length}, by yield
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
    </section>
  );
}
