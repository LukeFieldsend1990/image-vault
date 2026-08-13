"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface SecondaryActor {
  talentId: string | null;
  name: string;
  profileImageUrl: string | null;
  confidence: number;
  source: string;
  onboarded: boolean;
}

interface OffenderHit {
  id: string;
  contentUrl: string;
  caption: string | null;
  thumbnailUrl: string | null;
  discoverySource: string | null;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: string;
  status: string;
  detectedAt: number;
  secondaryActors?: SecondaryActor[];
}

interface OffenderAccount {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  hitCount: number;
  cumulativeViews: number;
  talentAffectedCount: number;
  status: string;
  notes: string | null;
  hitsForTalent: number;
  openHitsForTalent: number;
  priority: number;
  priorityReason: string;
  hits: OffenderHit[];
}

const RISK_COLORS: Record<string, { bg: string; fg: string }> = {
  low: { bg: "rgba(107,114,128,0.12)", fg: "#6b7280" },
  medium: { bg: "rgba(217,119,6,0.12)", fg: "#d97706" },
  high: { bg: "rgba(239,68,68,0.12)", fg: "#dc2626" },
  critical: { bg: "rgba(127,29,29,0.15)", fg: "#7f1d1d" },
};

const STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  watchlist: { label: "On watchlist", fg: "#d97706", bg: "rgba(217,119,6,0.12)" },
  reported: { label: "Reported to platform", fg: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  suspended: { label: "Removed", fg: "#16a34a", bg: "rgba(34,197,94,0.12)" },
  cleared: { label: "Cleared", fg: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function formatRelative(unix: number): string {
  const diff = Date.now() - unix * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p
        className="text-xs font-medium tracking-widest uppercase"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </p>
      <p className="mt-1 font-mono text-lg" style={{ color: "var(--color-ink)" }}>
        {value}
      </p>
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Tiny round headshot used in the accounts view; smaller than the monitor
 *  view's SecondaryAvatar to fit alongside a thumbnail without crowding.
 *  Onboarded actors get an accent ring; non-onboarded get a soft border. */
function MiniAvatar({ actor }: { actor: SecondaryActor }) {
  const initials = actor.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const ring = actor.onboarded ? "var(--color-accent)" : "var(--color-border)";
  const label = actor.onboarded
    ? `${actor.name} — on ImageVault (${actor.confidence}%)`
    : `${actor.name} — not on ImageVault (${actor.confidence}%)`;
  return (
    <div
      title={label}
      className="relative h-5 w-5 rounded-full overflow-hidden"
      style={{
        border: `1.5px solid var(--color-bg)`,
        boxShadow: `0 0 0 1px ${ring}`,
      }}
    >
      {actor.profileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={actor.profileImageUrl}
          alt={actor.name}
          className="h-full w-full object-cover"
          style={{ opacity: actor.onboarded ? 1 : 0.85 }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-[8px] font-semibold"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {initials || "?"}
        </div>
      )}
    </div>
  );
}

function AccountCard({
  account,
  onStatus,
  busy,
}: {
  account: OffenderAccount;
  onStatus: (id: string, status: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_META[account.status] ?? STATUS_META.watchlist;
  const active = account.status === "watchlist" || account.status === "reported";

  return (
    <div
      className="rounded-md border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                @{account.handle}
              </h3>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {PLATFORM_LABELS[account.platform] ?? account.platform}
              </span>
              <span
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{ background: status.bg, color: status.fg }}
              >
                {status.label}
              </span>
            </div>
            {account.displayName && (
              <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                {account.displayName}
                {account.followerCount != null && ` · ${formatCompact(account.followerCount)} followers`}
              </p>
            )}
          </div>

          {active && (
            <div className="text-right shrink-0">
              <p className="font-mono text-2xl leading-none" style={{ color: "var(--color-accent)" }}>
                {account.priority}
              </p>
              <p
                className="text-xs font-medium tracking-widest uppercase mt-1"
                style={{ color: "var(--color-muted)" }}
              >
                Priority
              </p>
            </div>
          )}
        </div>

        {/* Why this account sits where it does in the queue. */}
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {account.priorityReason}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
          <Stat
            label="Reach"
            value={formatCompact(account.cumulativeViews)}
            hint="views on flagged posts"
          />
          <Stat
            label="Posts"
            value={String(account.hitsForTalent)}
            hint={account.openHitsForTalent ? `${account.openHitsForTalent} open` : "all triaged"}
          />
          <Stat label="First seen" value={formatRelative(account.firstSeenAt)} />
          <Stat label="Last seen" value={formatRelative(account.lastSeenAt)} />
        </div>

        {account.talentAffectedCount > 1 && (
          <div
            className="rounded border px-3 py-2.5"
            style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "#dc2626" }}>
              Also targeting {account.talentAffectedCount - 1} other protected{" "}
              {account.talentAffectedCount - 1 === 1 ? "talent" : "talent"} on ImageVault
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              A pattern across multiple represented people is evidence of a commercial operation — it
              escalates to platform partner channels rather than a per-post report.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium underline underline-offset-2"
            style={{ color: "var(--color-muted)" }}
          >
            {expanded ? "Hide" : `Show ${account.hitsForTalent} flagged ${account.hitsForTalent === 1 ? "post" : "posts"}`}
          </button>
          <span style={{ color: "var(--color-border)" }}>·</span>
          <a
            href={`https://www.instagram.com/${account.handle}/`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-xs font-medium underline underline-offset-2"
            style={{ color: "var(--color-muted)" }}
          >
            Open account
          </a>

          <div className="ml-auto flex items-center gap-2">
            {account.status !== "reported" && account.status !== "suspended" && (
              <button
                onClick={() => onStatus(account.id, "reported")}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
                style={{
                  background: "var(--color-ink)",
                  color: "#fff",
                  borderRadius: "var(--radius)",
                }}
              >
                Mark reported
              </button>
            )}
            {account.status !== "suspended" && (
              <button
                onClick={() => onStatus(account.id, "suspended")}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium border transition disabled:opacity-50"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-ink)",
                  borderRadius: "var(--radius)",
                }}
              >
                Removed
              </button>
            )}
            {account.status !== "cleared" && account.status !== "suspended" && (
              <button
                onClick={() => onStatus(account.id, "cleared")}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium border transition disabled:opacity-50"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted)",
                  borderRadius: "var(--radius)",
                }}
              >
                Not a problem
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-5 py-4 space-y-3" style={{ borderColor: "var(--color-border)" }}>
          {account.hits.map((hit) => {
            const risk = RISK_COLORS[hit.riskLevel] ?? RISK_COLORS.medium;
            return (
              <div key={hit.id} className="flex gap-3">
                {hit.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hit.thumbnailUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded object-cover"
                    style={{ border: "1px solid var(--color-border)" }}
                  />
                ) : (
                  <div
                    className="h-14 w-14 shrink-0 rounded"
                    style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="rounded px-1.5 py-0.5 text-xs font-medium capitalize"
                      style={{ background: risk.bg, color: risk.fg }}
                    >
                      {hit.riskLevel}
                    </span>
                    <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>
                      {hit.aiGeneratedLikelihood}% AI
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {formatRelative(hit.detectedAt)}
                    </span>
                  </div>
                  {hit.caption && (
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-text)" }}>
                      {hit.caption}
                    </p>
                  )}
                  {hit.secondaryActors && hit.secondaryActors.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <div className="flex -space-x-1.5">
                        {hit.secondaryActors.slice(0, 5).map((actor, i) => (
                          <MiniAvatar key={i} actor={actor} />
                        ))}
                        {hit.secondaryActors.length > 5 && (
                          <div
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold"
                            style={{
                              background: "var(--color-surface)",
                              border: "1.5px solid var(--color-bg)",
                              color: "var(--color-muted)",
                            }}
                          >
                            +{hit.secondaryActors.length - 5}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                        also in this content
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <a
                      href={hit.contentUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-xs underline underline-offset-2"
                      style={{ color: "var(--color-muted)" }}
                    >
                      View post
                    </a>
                    {hit.discoverySource && (
                      <span className="font-mono text-xs" style={{ color: "var(--color-muted)" }}>
                        found via {hit.discoverySource}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AccountsClient({ talentName }: { talentName: string }) {
  const [accounts, setAccounts] = useState<OffenderAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor/accounts");
      if (!res.ok) return;
      const data = (await res.json()) as { accounts: OffenderAccount[] };
      setAccounts(data.accounts);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = useCallback(
    async (id: string, status: string) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/monitor/accounts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (res.ok) await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const active = accounts.filter((a) => a.status === "watchlist" || a.status === "reported");
  const closed = accounts.filter((a) => a.status === "suspended" || a.status === "cleared");
  const totalReach = active.reduce((sum, a) => sum + a.cumulativeViews, 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <div>
        <Link
          href="/vault/monitor"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "var(--color-muted)" }}
        >
          ← Likeness Monitor
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Accounts
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          The accounts publishing synthetic content of {talentName}, ranked by reach. Individual posts
          are cheap to repost — the account is what has to grow to make money, so it is the thing worth
          shutting down.
        </p>
      </div>

      {loaded && active.length > 0 && (
        <div
          className="grid grid-cols-3 gap-4 rounded-md border px-5 py-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <Stat label="Active" value={String(active.length)} hint="accounts in play" />
          <Stat label="Combined reach" value={formatCompact(totalReach)} hint="views to remove" />
          <Stat
            label="Reported"
            value={String(accounts.filter((a) => a.status === "reported").length)}
            hint="awaiting platform"
          />
        </div>
      )}

      {!loaded && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Loading…
        </p>
      )}

      {loaded && accounts.length === 0 && (
        <div
          className="rounded-md border px-5 py-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            No accounts on file
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
            Case files are opened automatically the first time a sweep flags a post. Run a scan from the
            monitor to start building the picture.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-4">
          <h2
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Priority queue
          </h2>
          {active.map((a) => (
            <AccountCard key={a.id} account={a} onStatus={setStatus} busy={busy === a.id} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-4">
          <h2
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Closed
          </h2>
          {closed.map((a) => (
            <AccountCard key={a.id} account={a} onStatus={setStatus} busy={busy === a.id} />
          ))}
        </div>
      )}
    </div>
  );
}
