"use client";

import { useCallback, useEffect, useState } from "react";

interface Takedown {
  id: string;
  talentId: string;
  talentName: string;
  talentEmail: string;
  authorizationOnFile: boolean;
  platform: string;
  contentUrl: string;
  authorHandle: string | null;
  caption: string | null;
  riskLevel: string;
  confidence: number;
  aiGeneratedLikelihood: number;
  status: string;
  requestedAt: number | null;
  detectedAt: number;
  account: {
    handle: string;
    displayName: string | null;
    followerCount: number | null;
    status: string;
  } | null;
  submission: {
    id: string;
    recipient: string;
    method: string;
    sentAt: number;
    platformStatus: string;
    platformReference: string | null;
  } | null;
}

type Filter = "open" | "closed" | "all";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

function when(unix: number | null): string {
  if (!unix) return "—";
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ageDays(unix: number | null): number {
  if (!unix) return 0;
  return Math.floor((Math.floor(Date.now() / 1000) - unix) / 86400);
}

export default function TakedownsClient() {
  const [takedowns, setTakedowns] = useState<Takedown[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/monitor/takedowns?status=${filter}`);
    if (!res.ok) return;
    const data = (await res.json()) as { takedowns: Takedown[] };
    setTakedowns(data.takedowns);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = useCallback(
    async (hitId: string, status: "resolved" | "dismissed") => {
      setBusy(hitId);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/takedowns", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hitId, status }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setMessage(err.error ?? "Update failed");
          return;
        }
        setMessage(status === "resolved" ? "Marked resolved" : "Marked dismissed");
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const submit = useCallback(
    async (hitId: string) => {
      setBusy(hitId);
      setMessage(null);
      try {
        const res = await fetch(`/api/admin/monitor/takedowns/${hitId}/submit`, {
          method: "POST",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          recipient?: string;
          reference?: string;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          setMessage(data.error ?? "Send failed");
          return;
        }
        setMessage(`Sent to ${data.recipient} (ref ${data.reference})`);
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const open = takedowns.filter((t) => t.status === "takedown_requested");
  const stale = open.filter((t) => ageDays(t.requestedAt) >= 3);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Takedown backlog
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Every hit a talent asked us to file a takedown for. Once the Meta contact loop lands, this
            list is what it drains. Stale (≥ 3d) means the request has been sitting long enough that a
            human should probably chase it now.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {(["open", "closed", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-2 py-1 rounded"
              style={{
                background: filter === f ? "var(--color-accent)" : "var(--color-surface)",
                color: filter === f ? "white" : "var(--color-ink)",
                border: "1px solid var(--color-border)",
                textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open requests" value={open.length} />
        <Stat label="Stale (≥ 3d)" value={stale.length} accent={stale.length > 0} />
        <Stat label="On screen" value={takedowns.length} />
      </div>

      {message && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}>
          {message}
        </div>
      )}

      {takedowns.length === 0 ? (
        <div
          className="rounded p-6 text-sm text-center"
          style={{
            border: "1px dashed var(--color-border)",
            color: "var(--color-muted)",
          }}
        >
          {filter === "open"
            ? "No open takedown requests. When a talent taps 'Request takedown' on a flagged hit, it lands here."
            : "No takedowns in this view."}
        </div>
      ) : (
        <ul className="space-y-3">
          {takedowns.map((t) => (
            <li
              key={t.id}
              className="rounded p-4 space-y-3"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-muted)" }}>
                    <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{t.talentName}</span>
                    <span>·</span>
                    <span>{PLATFORM_LABEL[t.platform] ?? t.platform}</span>
                    <span>·</span>
                    <span>{t.authorHandle ?? "unknown"}</span>
                  </div>
                  {t.caption && (
                    <p className="mt-1 text-sm line-clamp-2" style={{ color: "var(--color-ink)" }}>
                      &ldquo;{t.caption.slice(0, 220)}
                      {t.caption.length > 220 ? "…" : ""}&rdquo;
                    </p>
                  )}
                </div>
                <StatusPill status={t.status} />
              </div>

              <div className="flex items-center gap-4 text-xs" style={{ color: "var(--color-muted)" }}>
                <span>
                  Requested {when(t.requestedAt)}
                  {ageDays(t.requestedAt) >= 3 && t.status === "takedown_requested" && (
                    <span className="ml-1 font-medium" style={{ color: "var(--color-accent)" }}>
                      · stale
                    </span>
                  )}
                </span>
                <span>Detected {when(t.detectedAt)}</span>
                <span>Risk: {t.riskLevel}</span>
                <span>AI: {t.aiGeneratedLikelihood}%</span>
              </div>

              {t.submission && (
                <div
                  className="text-xs px-3 py-2 rounded"
                  style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                >
                  <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>
                    Sent to {t.submission.recipient}
                  </span>{" "}
                  · {when(t.submission.sentAt)} · {t.submission.method} · status: {t.submission.platformStatus}
                  {t.submission.platformReference ? ` · ref ${t.submission.platformReference}` : ""}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <a
                  href={t.contentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                  style={{ color: "var(--color-accent)" }}
                >
                  View content →
                </a>
                {t.status === "takedown_requested" && (
                  <div className="flex gap-2">
                    {!t.submission && (
                      <button
                        onClick={() => void submit(t.id)}
                        disabled={busy === t.id || !t.authorizationOnFile}
                        title={
                          t.authorizationOnFile
                            ? "Send the takedown letter to the platform"
                            : "Blocked — no signed enforcement authorization on file for this talent."
                        }
                        className="text-xs px-3 py-1.5 rounded"
                        style={{
                          background: t.authorizationOnFile ? "var(--color-ink)" : "var(--color-surface)",
                          color: t.authorizationOnFile ? "white" : "var(--color-muted)",
                          border: t.authorizationOnFile ? "none" : "1px solid var(--color-border)",
                          opacity: busy === t.id ? 0.5 : 1,
                          cursor: t.authorizationOnFile ? "pointer" : "not-allowed",
                        }}
                      >
                        Send report to Meta
                      </button>
                    )}
                    <button
                      onClick={() => void mark(t.id, "resolved")}
                      disabled={busy === t.id}
                      className="text-xs px-3 py-1.5 rounded"
                      style={{
                        background: "var(--color-accent)",
                        color: "white",
                        opacity: busy === t.id ? 0.5 : 1,
                      }}
                    >
                      Mark resolved
                    </button>
                    <button
                      onClick={() => void mark(t.id, "dismissed")}
                      disabled={busy === t.id}
                      className="text-xs px-3 py-1.5 rounded"
                      style={{
                        border: "1px solid var(--color-border)",
                        color: "var(--color-ink)",
                        opacity: busy === t.id ? 0.5 : 1,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className="rounded p-3"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="text-xs" style={{ color: "var(--color-muted)" }}>
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-semibold"
        style={{ color: accent && value > 0 ? "var(--color-accent)" : "var(--color-ink)" }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "takedown_requested" ? "Open" : status === "resolved" ? "Resolved" : "Dismissed";
  const isOpen = status === "takedown_requested";
  return (
    <span
      className="text-xs px-2 py-0.5 rounded"
      style={{
        background: isOpen ? "var(--color-accent)" : "var(--color-surface)",
        color: isOpen ? "white" : "var(--color-muted)",
        border: isOpen ? "none" : "1px solid var(--color-border)",
      }}
    >
      {label}
    </span>
  );
}
