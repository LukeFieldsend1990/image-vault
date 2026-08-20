/**
 * Marketing recreations of the live Likeness Monitor screens.
 *
 * Faithful to the real review queue (app/(vault)/vault/monitor/monitor-client.tsx)
 * and account watchlist (accounts/accounts-client.tsx): the platform accent
 * edge and tinted icon chip come from lib/monitor/platform-brand.ts, risk
 * chips and confidence-bar thresholds match RISK_COLORS / ConfidenceBar, and
 * the NSFW badge is the same solid-ink pill. Colour literals are the
 * platforms' own, copied from platform-brand.ts — they must not follow the
 * app theme. Every handle, caption and face is fictional (the "Marlowe Quinn"
 * demo persona and the invented "@velmirastudios" demo offender) — avatars are
 * initials, never real photographs.
 */

import { BrowserFrame } from "./mockups";

/* ── Platform brand accents (from lib/monitor/platform-brand.ts) ── */
const BRANDS = {
  instagram: {
    color: "#dd2a7b",
    edge: "linear-gradient(180deg, #f58529 0%, #dd2a7b 55%, #8134af 100%)",
    tint: "rgba(221, 42, 123, 0.10)",
  },
  tiktok: {
    color: "#fe2c55",
    edge: "linear-gradient(180deg, #25f4ee 0%, #fe2c55 100%)",
    tint: "rgba(254, 44, 85, 0.09)",
  },
  youtube: {
    color: "#ff0000",
    edge: "#ff0000",
    tint: "rgba(255, 0, 0, 0.08)",
  },
  reddit: {
    color: "#ff4500",
    edge: "#ff4500",
    tint: "rgba(255, 69, 0, 0.08)",
  },
} as const;

/* ── Risk chips (from monitor-client RISK_COLORS) ── */
const RISK = {
  medium: { bg: "rgba(217,119,6,0.12)", fg: "#d97706" },
  high: { bg: "rgba(239,68,68,0.12)", fg: "#dc2626" },
} as const;

/* ── Platform glyphs (same paths as the live monitor) ── */
export function InstagramGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function TikTokGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.22 8.22 0 0 0 4.8 1.54V6.78a4.85 4.85 0 0 1-1.04-.09z" />
    </svg>
  );
}

export function YouTubeGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3.01 3.01 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3.01 3.01 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3.01 3.01 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3.01 3.01 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.75 15.5V8.5l6.25 3.5-6.25 3.5z" />
    </svg>
  );
}

export function RedditGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .379.377 1.008.561 1.924.561l.008.002.008-.002c.915 0 1.544-.184 1.924-.561.085-.084.223-.084.307 0zm-3.44-2.418c0-.507-.414-.919-.922-.919-.509 0-.923.412-.923.919 0 .506.414.918.923.918.508.001.922-.411.922-.918zm13.202-.93c0 6.627-5.373 12-12 12s-12-5.373-12-12 5.373-12 12-12 12 5.373 12 12zm-5-.129c0-.851-.695-1.543-1.55-1.543-.417 0-.795.167-1.074.435-1.056-.695-2.485-1.137-4.066-1.194l.865-2.724 2.343.549-.003.034c0 .696.569 1.262 1.268 1.262.699 0 1.267-.566 1.267-1.262s-.568-1.262-1.267-1.262c-.537 0-.994.335-1.179.804l-2.525-.592c-.11-.027-.223.037-.257.145l-.965 3.038c-1.656.02-3.155.466-4.258 1.181-.277-.255-.644-.415-1.05-.415-.854.001-1.549.693-1.549 1.544 0 .566.311 1.056.768 1.325-.03.164-.05.331-.05.5 0 2.281 2.805 4.137 6.253 4.137s6.253-1.856 6.253-4.137c0-.16-.017-.317-.044-.472.486-.261.82-.766.82-1.353zm-4.872.141c-.509 0-.922.412-.922.919 0 .506.414.918.922.918s.922-.412.922-.918c0-.507-.413-.919-.922-.919z" />
    </svg>
  );
}

/* ── Shared bits ── */

/** Solid-ink NSFW pill, matching the live NsfwBadge. */
function NsfwPill() {
  return (
    <span
      className="inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider"
      style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}
    >
      NSFW
    </span>
  );
}

/** Confidence bar with the live thresholds: ≥85 red, ≥65 amber, else grey. */
function Meter({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? "#dc2626" : value >= 65 ? "#d97706" : "#6b7280";
  return (
    <div className="min-w-[110px] flex-1">
      <div className="flex items-baseline justify-between">
        <p className="text-[8px] font-semibold tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          {label}
        </p>
        <p className="text-[10px] font-semibold" style={{ color }}>
          {value}%
        </p>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

/** Overlapping initials avatars — neutral monograms, never real faces. */
function ActorStack({ initials }: { initials: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-[8px] font-semibold tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
        Also in this content
      </p>
      <div className="flex -space-x-1.5">
        {initials.map((m) => (
          <span
            key={m}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[7px] font-semibold"
            style={{
              background: "var(--color-surface)",
              color: "var(--color-muted)",
              border: "1.5px solid var(--color-bg)",
              boxShadow: "0 0 0 1px var(--color-border)",
            }}
          >
            {m}
          </span>
        ))}
      </div>
      <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
        {initials.length} actors identified
      </span>
    </div>
  );
}

function GhostButton({ label, tone = "ink" }: { label: string; tone?: "ink" | "muted" | "green" }) {
  const color =
    tone === "green" ? "#16a34a" : tone === "muted" ? "var(--color-muted)" : "var(--color-ink)";
  return (
    <span
      className="inline-flex items-center rounded border px-2.5 py-1 text-[9px] font-medium"
      style={{ borderColor: "var(--color-border)", color }}
    >
      {label}
    </span>
  );
}

/* ── Hit card, at marketing scale ── */

interface HitMock {
  brand: (typeof BRANDS)[keyof typeof BRANDS];
  icon: React.ReactNode;
  platform: string;
  handle: string;
  risk: { label: string; bg: string; fg: string };
  nsfw?: boolean;
  status: string;
  time: string;
  caption: string;
  likeness: number;
  ai: number;
  actors?: string[];
  fold: string;
  actions: "open" | "takedown_requested";
}

function HitCardMock({ hit }: { hit: HitMock }) {
  return (
    <div
      className="relative space-y-2.5 overflow-hidden rounded-md border p-3 pl-4"
      style={{
        borderColor: hit.status === "New" ? "rgba(239,68,68,0.35)" : "var(--color-border)",
        background: "var(--color-bg)",
      }}
    >
      {/* Platform accent edge — the one brand element each card carries. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: hit.brand.edge }} />
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ background: hit.brand.tint, color: hit.brand.color }}
        >
          {hit.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[11px] font-semibold" style={{ color: "var(--color-ink)" }}>
              {hit.platform}
            </p>
            <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
              {hit.handle}
            </span>
            <span
              className="inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider"
              style={{ background: hit.risk.bg, color: hit.risk.fg }}
            >
              {hit.risk.label}
            </span>
            {hit.nsfw && <NsfwPill />}
            <span
              className="inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-medium"
              style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
            >
              {hit.status}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[9px]" style={{ color: "var(--color-muted)" }}>
            &ldquo;{hit.caption}&rdquo;
          </p>
        </div>
        <span className="shrink-0 text-[9px]" style={{ color: "var(--color-muted)" }}>
          {hit.time}
        </span>
      </div>

      <div className="flex flex-wrap gap-4">
        <Meter label="Likeness match" value={hit.likeness} />
        <Meter label="AI-generated" value={hit.ai} />
      </div>

      {hit.actors && <ActorStack initials={hit.actors} />}

      <p className="flex items-center gap-1 text-[9px] font-medium" style={{ color: "var(--color-muted)" }}>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {hit.fold}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <GhostButton label="Preview" />
        <GhostButton label="Open on platform" tone="muted" />
        {hit.actions === "open" ? (
          <>
            <span
              className="inline-flex items-center rounded px-2.5 py-1 text-[9px] font-medium text-white"
              style={{ background: "var(--color-accent)" }}
            >
              Request takedown
            </span>
            <GhostButton label="Dismiss ▾" />
          </>
        ) : (
          <GhostButton label="Mark resolved" tone="green" />
        )}
      </div>
    </div>
  );
}

/* ── Review queue — three hits, three platforms, three postures ── */

export function MonitorHitsMockup() {
  const hits: HitMock[] = [
    {
      brand: BRANDS.instagram,
      icon: <InstagramGlyph size={15} />,
      platform: "Instagram Reels",
      handle: "@velmirastudios",
      risk: { label: "Medium", ...RISK.medium },
      status: "New",
      time: "3d ago",
      caption: "MARLOWE QUINN returns — TIDEWATER 2 (2027) Concept Trailer #tidewater #marlowequinn Watch the dark What If story where…",
      likeness: 72,
      ai: 75,
      actors: ["JR", "DK", "AL"],
      fold: "3 match signals · adjudicator note",
      actions: "open",
    },
    {
      brand: BRANDS.reddit,
      icon: <RedditGlyph size={15} />,
      platform: "Reddit",
      handle: "u/gen_reels_daily",
      risk: { label: "High", ...RISK.high },
      nsfw: true,
      status: "New",
      time: "1d ago",
      caption: "Marlowe Quinn AI set — full renders in comments",
      likeness: 91,
      ai: 88,
      fold: "4 match signals · adjudicator note",
      actions: "open",
    },
    {
      brand: BRANDS.youtube,
      icon: <YouTubeGlyph size={15} />,
      platform: "YouTube Shorts",
      handle: "@fancutsHD",
      risk: { label: "Medium", ...RISK.medium },
      status: "Takedown requested",
      time: "6d ago",
      caption: "Tidewater 2 — AI fan trailer (Marlowe Quinn, 4K)",
      likeness: 84,
      ai: 90,
      actors: ["JR", "TB"],
      fold: "2 match signals · adjudicator note",
      actions: "takedown_requested",
    },
  ];
  return (
    <BrowserFrame url="imagevault.ai/vault/monitor">
      <div className="space-y-2.5 p-4">
        <div className="flex items-baseline justify-between px-0.5">
          <p className="text-[9px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Review queue
          </p>
          <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
            3 hits awaiting review · last sweep 2h ago
          </p>
        </div>
        {hits.map((hit) => (
          <HitCardMock key={hit.handle} hit={hit} />
        ))}
      </div>
    </BrowserFrame>
  );
}

/* ── Account watchlist — the operators behind the hits ── */

function StatMock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[8px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm" style={{ color: "var(--color-ink)" }}>
        {value}
      </p>
      {hint && (
        <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function MonitorWatchlistMockup() {
  return (
    <BrowserFrame url="imagevault.ai/vault/monitor/accounts">
      <div className="space-y-2.5 p-4">
        <div className="flex items-baseline justify-between px-0.5">
          <p className="text-[9px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Account watchlist
          </p>
          <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
            Ordered by priority
          </p>
        </div>

        {/* Primary offender card — TikTok, on watchlist, priority 80. */}
        <div
          className="relative overflow-hidden rounded-md border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: BRANDS.tiktok.edge }} />
          <div className="space-y-3 p-4 pl-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--color-ink)" }}>
                    @velmirastudios
                  </p>
                  <span
                    className="rounded px-1.5 py-0.5 text-[8px] font-semibold"
                    style={{ background: BRANDS.tiktok.tint, color: BRANDS.tiktok.color }}
                  >
                    TikTok
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[8px] font-medium"
                    style={{ background: "rgba(217,119,6,0.12)", color: "#d97706" }}
                  >
                    On watchlist
                  </span>
                </div>
                <p className="mt-0.5 text-[9px]" style={{ color: "var(--color-muted)" }}>
                  Velmira Studios · 155k followers
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xl leading-none" style={{ color: "var(--color-accent)" }}>
                  80
                </p>
                <p className="mt-0.5 text-[8px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                  Priority
                </p>
              </div>
            </div>

            <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
              4.9M views across flagged posts · active this week · 4 open hits
            </p>

            <div className="grid grid-cols-4 gap-3">
              <StatMock label="Reach" value="4.9M" hint="views on flagged posts" />
              <StatMock label="Posts" value="4" hint="4 open" />
              <StatMock label="First seen" value="6d ago" />
              <StatMock label="Last seen" value="6d ago" />
            </div>

            <div
              className="rounded border px-2.5 py-2"
              style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
            >
              <p className="text-[9px] font-semibold" style={{ color: "#dc2626" }}>
                Also targeting 2 other protected talent on ImageVault
              </p>
              <p className="mt-0.5 text-[8px] leading-relaxed" style={{ color: "var(--color-muted)" }}>
                A pattern across multiple represented people is evidence of a commercial operation —
                it escalates to platform partner channels rather than a per-post report.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-medium underline underline-offset-2" style={{ color: "var(--color-muted)" }}>
                Show 4 flagged posts
              </span>
              <span style={{ color: "var(--color-border)" }}>·</span>
              <span className="text-[9px] font-medium underline underline-offset-2" style={{ color: "var(--color-muted)" }}>
                Open account
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <span
                  className="rounded px-2.5 py-1 text-[9px] font-medium text-white"
                  style={{ background: "var(--color-ink)" }}
                >
                  Mark reported
                </span>
                <GhostButton label="Removed" />
                <GhostButton label="Contact" />
                <GhostButton label="Whitelist ▾" tone="muted" />
              </span>
            </div>
          </div>
        </div>

        {/* Second operator, condensed — Instagram sibling, already reported. */}
        <div
          className="relative overflow-hidden rounded-md border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: BRANDS.instagram.edge }} />
          <div className="flex items-center justify-between gap-3 p-4 pl-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--color-ink)" }}>
                  @velmirastudios
                </p>
                <span
                  className="rounded px-1.5 py-0.5 text-[8px] font-semibold"
                  style={{ background: BRANDS.instagram.tint, color: BRANDS.instagram.color }}
                >
                  Instagram
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[8px] font-medium"
                  style={{ background: "rgba(37,99,235,0.12)", color: "#2563eb" }}
                >
                  Reported to platform
                </span>
              </div>
              <p className="mt-0.5 text-[9px]" style={{ color: "var(--color-muted)" }}>
                Cross-platform sibling · confirmed by matching captions
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-xl leading-none" style={{ color: "var(--color-accent)" }}>
                64
              </p>
              <p className="mt-0.5 text-[8px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                Priority
              </p>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
