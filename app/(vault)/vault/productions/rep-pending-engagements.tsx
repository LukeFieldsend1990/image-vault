"use client";

import { useEffect, useState } from "react";

interface Placeholder {
  castId: string;
  productionId: string;
  productionName: string;
  productionStatus: string | null;
  productionType: string | null;
  productionYear: number | null;
  companyName: string;
  actorName: string | null;
  characterName: string | null;
  addedAt: number;
}

const TYPE_LABEL: Record<string, string> = {
  film: "Feature Film",
  tv_series: "TV Series",
  tv_movie: "TV Movie",
  commercial: "Commercial",
  game: "Game",
  music_video: "Music Video",
  other: "Production",
};

type ConnectState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; status: string }
  | { kind: "error"; message: string };

function PlaceholderCard({ p, onConnected }: { p: Placeholder; onConnected: (castId: string) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ConnectState>({ kind: "idle" });

  async function connect() {
    const trimmed = email.trim();
    if (!trimmed) {
      setState({ kind: "error", message: "Enter your client's email address." });
      return;
    }
    setState({ kind: "busy" });
    try {
      const r = await fetch(`/api/productions/${p.productionId}/cast/${p.castId}/rep-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const d = await r.json() as { ok?: boolean; status?: string; error?: string };
      if (!r.ok || !d.ok) {
        setState({ kind: "error", message: d.error ?? "Couldn't connect your client. Please try again." });
        return;
      }
      setState({ kind: "done", status: d.status ?? "invited" });
      setTimeout(() => onConnected(p.castId), 2400);
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  const role = p.characterName ?? p.actorName ?? "a reserved role";
  const eyebrow = [
    p.productionType ? TYPE_LABEL[p.productionType] ?? p.productionType : null,
    p.productionYear ? String(p.productionYear) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
        {eyebrow && (
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>
            {eyebrow}
          </p>
        )}
        <h3 className="text-lg font-semibold leading-tight" style={{ color: "var(--color-ink)" }}>
          {p.productionName}
        </h3>
        <p className="mt-0.5 text-sm" style={{ color: "var(--color-muted)" }}>{p.companyName}</p>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm"
            style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)" }}
          >
            Reserved for your client
          </span>
          {p.characterName && (
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              as <span className="font-medium" style={{ color: "var(--color-text)" }}>{p.characterName}</span>
            </span>
          )}
        </div>
      </div>

      {/* Connect form */}
      <div className="px-5 py-4">
        {state.kind === "done" ? (
          <div className="flex items-start gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" style={{ color: "#16a34a" }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {state.status === "invited"
                  ? "Invite sent to your client"
                  : "Your client has been connected"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                {state.status === "invited"
                  ? `They'll receive a signup link. Once they join, the ${p.productionName} licence will be waiting for their approval.`
                  : `The licence request for ${p.productionName} is now with your client to approve.`}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
              {p.companyName} reserved the role of <span className="font-medium" style={{ color: "var(--color-text)" }}>{role}</span> for your client.
              Enter their email to connect them — if they&apos;re not on Image Vault yet, we&apos;ll send them a signup link.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (state.kind === "error") setState({ kind: "idle" }); }}
                onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
                placeholder="Your client's email address"
                disabled={state.kind === "busy"}
                className="flex-1 min-w-0"
                style={{
                  background: "var(--color-bg)",
                  border: `1px solid ${state.kind === "error" ? "var(--color-accent)" : "var(--color-border)"}`,
                  borderRadius: 6,
                  padding: "7px 11px",
                  fontSize: 13,
                  color: "var(--color-text)",
                  outline: "none",
                }}
              />
              <button
                onClick={connect}
                disabled={state.kind === "busy"}
                className="shrink-0 rounded px-4 py-2 text-sm font-medium text-white"
                style={{ background: "var(--color-accent)", opacity: state.kind === "busy" ? 0.6 : 1, cursor: state.kind === "busy" ? "not-allowed" : "pointer" }}
              >
                {state.kind === "busy" ? "Connecting…" : "Connect client"}
              </button>
            </div>
            {state.kind === "error" && (
              <p className="text-xs mt-1.5" style={{ color: "var(--color-accent)" }}>{state.message}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function RepPendingEngagements() {
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/productions/rep-placeholders")
      .then((r) => r.json() as Promise<{ placeholders?: Placeholder[] }>)
      .then((d) => { setPlaceholders(d.placeholders ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  function onConnected(castId: string) {
    setPlaceholders((prev) => prev.filter((p) => p.castId !== castId));
  }

  if (!loaded || placeholders.length === 0) return null;

  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="h-1.5 w-1.5 rounded-full shrink-0 animate-pulse"
          style={{ background: "var(--color-accent)" }}
        />
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-accent)" }}>
          {placeholders.length === 1
            ? "1 pending engagement — connect your client"
            : `${placeholders.length} pending engagements — connect your clients`}
        </p>
      </div>
      <div className="space-y-4">
        {placeholders.map((p) => (
          <PlaceholderCard key={p.castId} p={p} onConnected={onConnected} />
        ))}
      </div>
    </div>
  );
}
