"use client";

import { useCallback, useEffect, useState } from "react";

interface AccountLink {
  id: string;
  platform: string;
  handle: string;
  status: "confirmed" | "name_only" | "not_found" | "dismissed";
  matchedPosts: number;
  bestSimilarity: number;
  examples: string[];
  promotedAccountId: string | null;
  createdAt: number;
  sourceHandle: string | null;
  sourcePlatform: string | null;
  sourceReach: number | null;
}

const STATUS_META: Record<AccountLink["status"], { label: string; fg: string; bg: string }> = {
  confirmed: { label: "Confirmed", fg: "#16a34a", bg: "rgba(34,197,94,0.12)" },
  name_only: { label: "Name only", fg: "#d97706", bg: "rgba(217,119,6,0.12)" },
  not_found: { label: "Not found", fg: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  dismissed: { label: "Dismissed", fg: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

function compact(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function CrossPlatformClient() {
  const [links, setLinks] = useState<AccountLink[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/links");
    if (!res.ok) return;
    const data = (await res.json()) as { links: AccountLink[] };
    setLinks(data.links);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string, action: "promote" | "dismiss") => {
      setBusy(id);
      try {
        const res = await fetch("/api/admin/monitor/links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (res.ok) await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  // Negatives are kept in the table so sweeps stop re-probing them, but they
  // are not what an operator is here to read.
  const open = links.filter((l) => l.status === "confirmed" || l.status === "name_only");
  const closed = links.filter((l) => l.status === "not_found" || l.status === "dismissed");
  const visible = showAll ? links : open;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>
          Cross-platform siblings
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Accounts that crosspost run the same handle on more than one platform. Each sweep probes the
          highest-reach quarter of the watchlist for the same handle elsewhere. A probe is confirmed when
          the account&apos;s posts repeat captions already flagged on the source account, and confirmed
          siblings are added to the watchlist automatically. Name-only matches are listed here for a
          decision; negatives are kept so the next sweep does not pay to ask again.
        </p>
      </div>

      {links.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No probes recorded yet. Sweeps run them once an account has enough reach to qualify.
        </p>
      ) : (
        <>
          <div
            className="rounded-md border overflow-x-auto"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Candidate", "Platform", "Source account", "Match", "Status", ""].map((h) => (
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
                {visible.map((link) => {
                  const meta = STATUS_META[link.status];
                  return (
                    <tr key={link.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-ink)" }}>
                        @{link.handle}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                        {link.platform}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--color-muted)" }}>
                        <span className="font-mono">@{link.sourceHandle ?? "—"}</span>
                        {link.sourcePlatform && ` · ${link.sourcePlatform}`}
                        {link.sourceReach ? ` · ${compact(link.sourceReach)} views` : ""}
                      </td>
                      <td className="px-4 py-2.5 font-mono" style={{ color: "var(--color-text)" }}>
                        {link.matchedPosts > 0
                          ? `${link.matchedPosts} post${link.matchedPosts === 1 ? "" : "s"} · ${link.bestSimilarity}%`
                          : link.bestSimilarity > 0
                            ? `${link.bestSimilarity}%`
                            : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="rounded px-1.5 py-0.5 font-medium"
                          style={{ background: meta.bg, color: meta.fg }}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {link.status === "name_only" && (
                          <>
                            <button
                              onClick={() => act(link.id, "promote")}
                              disabled={busy === link.id}
                              className="underline underline-offset-2 disabled:opacity-50"
                              style={{ color: "var(--color-ink)" }}
                            >
                              Add to watchlist
                            </button>
                            <span style={{ color: "var(--color-border)" }}> · </span>
                            <button
                              onClick={() => act(link.id, "dismiss")}
                              disabled={busy === link.id}
                              className="underline underline-offset-2 disabled:opacity-50"
                              style={{ color: "var(--color-muted)" }}
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                        {link.status === "confirmed" && link.examples.length > 0 && (
                          <a
                            href={link.examples[0]}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="underline underline-offset-2"
                            style={{ color: "var(--color-muted)" }}
                          >
                            View match
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {closed.length > 0 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs underline underline-offset-2"
              style={{ color: "var(--color-muted)" }}
            >
              {showAll
                ? "Hide closed probes"
                : `Show ${closed.length} closed probe${closed.length === 1 ? "" : "s"}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
