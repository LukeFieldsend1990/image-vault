"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buildTemplates, composeUrlFor, profileUrlFor, type OutreachPurpose } from "@/lib/monitor/outreach-templates";
import { platformBrand } from "@/lib/monitor/platform-brand";
import ReasonMenu, { type ReasonOption } from "@/app/components/reason-menu";

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
  pinterest: "Pinterest",
  google: "Google",
  getty: "Getty / Shutterstock",
  midjourney: "AI Platforms",
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

/** Tiny round headshot used in the accounts view. Neutral — no signal about
 *  onboarded vs non-onboarded, same as SecondaryActorStack. Falls back to
 *  initials on any image load error so a dead TMDB URL doesn't leave a
 *  broken-image icon in the card. */
function MiniAvatar({ actor }: { actor: SecondaryActor }) {
  const initials = actor.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const [broken, setBroken] = useState(false);
  const showImage = actor.profileImageUrl && !broken;
  return (
    <div
      title={`${actor.name} (${actor.confidence}%)`}
      className="relative h-5 w-5 rounded-full overflow-hidden"
      style={{
        border: `1.5px solid var(--color-bg)`,
        boxShadow: `0 0 0 1px var(--color-border)`,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={actor.profileImageUrl!}
          alt={actor.name}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
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

/**
 * Post preview for a flagged hit.
 *
 * Loaded through /api/monitor/hits/:id/thumbnail rather than hotlinked: the
 * platform CDNs reject a browser request carrying our Referer, so the stored
 * URL rendered as a broken-image icon in every row. The Worker fetches it and
 * streams it back. When the fetch fails anyway — a signed CDN URL that has
 * since expired, or a post already taken down — this falls back to a neutral
 * tile rather than the browser's broken-image glyph.
 */
function HitThumbnail({ hit }: { hit: OffenderHit }) {
  const [broken, setBroken] = useState(false);
  const showImage = !!hit.thumbnailUrl && !broken;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/monitor/hits/${hit.id}/thumbnail`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-14 w-14 shrink-0 rounded object-cover"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
      />
    );
  }

  return (
    <div
      title={hit.thumbnailUrl ? "Preview unavailable — open the post to view it" : "No preview captured"}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded"
      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    </div>
  );
}

/**
 * Compose-and-log outreach flow. We never send the message ourselves —
 * Instagram / TikTok DM APIs are locked down and any programmatic sending
 * gets treated as spam. So the modal does the two things we CAN do: pre-fill
 * a template the operator can copy, and deep-link them into the platform's
 * DM composer. On "Mark sent", the outreach row lands so we don't spam
 * the same account with a second message next week without knowing.
 */
function ContactModal({
  account,
  talentName,
  onClose,
}: {
  account: OffenderAccount;
  talentName: string;
  onClose: () => void;
}) {
  const templates = useMemo(
    () =>
      buildTemplates({
        talentName,
        accountHandle: account.handle,
        platform: account.platform,
      }),
    [talentName, account.handle, account.platform]
  );
  const [purpose, setPurpose] = useState<OutreachPurpose>(templates[0].purpose);
  const [body, setBody] = useState(templates[0].body);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const composeUrl = composeUrlFor(account.platform, account.handle);

  const switchPurpose = (p: OutreachPurpose) => {
    setPurpose(p);
    const t = templates.find((x) => x.purpose === p);
    if (t) setBody(t.body);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus("Copy failed — select the text manually.");
    }
  };

  const logSent = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/monitor/accounts/${account.id}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "dm", purpose, messageBody: body }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus(data.error ?? "Log failed");
        return;
      }
      setStatus("Logged. Close when you're done.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.75)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative rounded-lg overflow-hidden flex flex-col"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          width: "min(640px, 100%)",
          maxHeight: "90vh",
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Contact @{account.handle}
            </h3>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {PLATFORM_LABELS[account.platform] ?? account.platform}
              {account.displayName ? ` · ${account.displayName}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-sm rounded p-1"
            style={{ color: "var(--color-muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <p
              className="text-[10px] uppercase tracking-widest font-semibold mb-2"
              style={{ color: "var(--color-muted)" }}
            >
              Message purpose
            </p>
            <div className="flex flex-wrap gap-1">
              {templates.map((t) => (
                <button
                  key={t.purpose}
                  onClick={() => switchPurpose(t.purpose)}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: purpose === t.purpose ? "var(--color-ink)" : "var(--color-surface)",
                    color: purpose === t.purpose ? "white" : "var(--color-ink)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p
              className="text-[10px] uppercase tracking-widest font-semibold mb-2"
              style={{ color: "var(--color-muted)" }}
            >
              Message
            </p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="w-full text-sm rounded p-3"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-ink)",
                fontFamily: "inherit",
              }}
            />
          </div>

          {status && (
            <div
              className="text-xs px-3 py-2 rounded"
              style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
            >
              {status}
            </div>
          )}

          <div
            className="text-xs px-3 py-2 rounded space-y-1"
            style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
          >
            <p style={{ color: "var(--color-ink)", fontWeight: 500 }}>How this works</p>
            <p>
              Platform DM APIs don&apos;t let us send messages on your behalf. Copy the message,
              open the platform&apos;s DM composer, paste and send, then click &quot;Mark sent&quot;
              here to log the outreach.
            </p>
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="text-xs px-3 py-1.5 rounded"
              style={{
                background: copied ? "var(--color-accent)" : "var(--color-surface)",
                color: copied ? "white" : "var(--color-ink)",
                border: "1px solid var(--color-border)",
              }}
            >
              {copied ? "Copied ✓" : "Copy message"}
            </button>
            {composeUrl && (
              <a
                href={composeUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded"
                style={{
                  background: "var(--color-surface)",
                  color: "var(--color-ink)",
                  border: "1px solid var(--color-border)",
                }}
              >
                Open on platform →
              </a>
            )}
          </div>
          <button
            onClick={() => void logSent()}
            disabled={busy || !body.trim()}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: body.trim() ? "var(--color-ink)" : "var(--color-surface)",
              color: body.trim() ? "white" : "var(--color-muted)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Mark sent
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Whitelist control for an account. Reasons and the free-text "other" branch
 * come from the shared ReasonMenu, which lays its panel out against the
 * viewport: the account card clips its own overflow, so an absolute dropdown
 * was cut off at the card's bottom edge on desktop.
 *
 * Structured reasons feed the admin panel, so we can aggregate what talents
 * whitelist and why.
 */
const WHITELIST_OPTIONS: ReasonOption[] = [
  { reason: "false_positive", label: "False positive \u2014 not misuse" },
  { reason: "fan_fluff", label: "Harmless fan content" },
  { reason: "talent_approved", label: "Talent has approved this account" },
  { reason: "other", label: "Other\u2026" },
];

function WhitelistMenu({
  accountId,
  onWhitelist,
  busy,
}: {
  accountId: string;
  onWhitelist: (id: string, reason: string, notes?: string) => void;
  busy: boolean;
}) {
  return (
    <ReasonMenu
      triggerLabel="Whitelist"
      options={WHITELIST_OPTIONS}
      busy={busy}
      width={256}
      notesPlaceholder="Why is this account being whitelisted?"
      confirmLabel="Whitelist"
      onPick={(reason, notes) => onWhitelist(accountId, reason, notes)}
    />
  );
}

function AccountCard({
  account,
  onStatus,
  onWhitelist,
  onContact,
  busy,
}: {
  account: OffenderAccount;
  onStatus: (id: string, status: string) => void;
  onWhitelist: (id: string, reason: string, notes?: string) => void;
  onContact: (account: OffenderAccount) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_META[account.status] ?? STATUS_META.watchlist;
  const active = account.status === "watchlist" || account.status === "reported";
  const brand = platformBrand(account.platform);

  return (
    <div
      className="relative overflow-hidden rounded-md border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Platform accent edge — matches the hit cards on the monitor page. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: brand.edge }} />
      <div className="p-5 pl-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-mono text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                @{account.handle}
              </h3>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: brand.tint, color: brand.color }}
              >
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
          {profileUrlFor(account.platform, account.handle) && (
            <>
              <span style={{ color: "var(--color-border)" }}>·</span>
              <a
                href={profileUrlFor(account.platform, account.handle)!}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-xs font-medium underline underline-offset-2"
                style={{ color: "var(--color-muted)" }}
              >
                Open account
              </a>
            </>
          )}

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
            {account.status !== "suspended" && (
              <button
                onClick={() => onContact(account)}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium border transition disabled:opacity-50"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-ink)",
                  borderRadius: "var(--radius)",
                }}
              >
                Contact
              </button>
            )}
            {account.status !== "cleared" && account.status !== "suspended" && (
              <WhitelistMenu accountId={account.id} onWhitelist={onWhitelist} busy={busy} />
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
                <HitThumbnail hit={hit} />
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
  const [contactAccount, setContactAccount] = useState<OffenderAccount | null>(null);

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

  const whitelistAccount = useCallback(
    async (id: string, reason: string, notes?: string) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/monitor/accounts/${id}/whitelist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, notes }),
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
            <AccountCard key={a.id} account={a} onStatus={setStatus} onWhitelist={whitelistAccount} onContact={setContactAccount} busy={busy === a.id} />
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
            <AccountCard key={a.id} account={a} onStatus={setStatus} onWhitelist={whitelistAccount} onContact={setContactAccount} busy={busy === a.id} />
          ))}
        </div>
      )}

      {contactAccount && (
        <ContactModal
          account={contactAccount}
          talentName={talentName}
          onClose={() => setContactAccount(null)}
        />
      )}
    </div>
  );
}
