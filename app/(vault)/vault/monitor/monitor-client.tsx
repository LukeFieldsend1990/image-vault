"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TalentIdentityForMonitor } from "./page";
import { embedInfoFor } from "@/lib/monitor/embed-url";
import { platformBrand } from "@/lib/monitor/platform-brand";
import ReasonMenu, { type ReasonOption } from "@/app/components/reason-menu";

// ── Types (mirror /api/monitor payloads) ────────────────────────────────────

type ScanStatus = "idle" | "checking" | "clear" | "flagged";

interface Platform {
  id: string;
  name: string;
  category: string;
  icon: React.ReactNode;
  status: ScanStatus;
  checkDuration: number;
  /** Standing coverage note shown as a chip on the sweep row ("NSFW"). */
  badge?: string;
}

interface SecondaryActor {
  talentId: string | null;
  name: string;
  profileImageUrl: string | null;
  confidence: number;
  source: string;
  onboarded: boolean;
}

interface LikenessHit {
  id: string;
  platform: string;
  contentType: string;
  contentUrl: string;
  authorHandle: string | null;
  caption: string | null;
  nsfw?: boolean;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: string;
  matchSignals: string[];
  aiRationale: string | null;
  status: string;
  detectedAt: number;
  secondaryActors?: SecondaryActor[];
}

interface ScanRecord {
  id: string;
  startedAt: number;
  status: string;
  error?: string | null;
  platformsChecked: number;
  candidatesAnalysed: number;
  hitsFound: number;
  aiProvider: string | null;
}

interface MonitorConfig {
  id: string;
  status: "active" | "paused";
  sensitivity: string;
  lastScanAt: number | null;
}

interface MonitorState {
  monitor: MonitorConfig | null;
  /** Platform ids the admin has switched on — the sweep's actual coverage. */
  enabledPlatforms?: string[];
  hits: LikenessHit[];
  scans: ScanRecord[];
}

interface ReferenceSetState {
  coverage: {
    tier: "unanchored" | "baseline" | "anchored" | "fortified";
    score: number;
    improvements: string[];
  };
  /** What the vault holds — the only thing the coverage card talks about. */
  vaultPackages?: { total: number; faceCount: number; bodyCount: number };
  /** Reference stills fingerprinted into the derivation (pHash) index. */
  phashIndexedCount?: number;
}

interface OffenderAccountSummary {
  id: string;
  status: string;
  cumulativeViews: number;
  openHitsForTalent: number;
}

interface ScanResponse {
  scanId: string;
  status: "running" | "complete" | "error";
  error?: string | null;
  platformsChecked: number;
  candidatesAnalysed: number;
  hitsFound?: number;
  newHits: LikenessHit[];
  aiProvider: string;
}

// ── Platform icons ──────────────────────────────────────────────────────────

function YouTubeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3.01 3.01 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3.01 3.01 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3.01 3.01 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3.01 3.01 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.75 15.5V8.5l6.25 3.5-6.25 3.5z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.22 8.22 0 0 0 4.8 1.54V6.78a4.85 4.85 0 0 1-1.04-.09z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function GettyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MidjourneyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function PinterestIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0a12 12 0 0 0-4.373 23.178c-.035-.95-.007-2.093.237-3.126l1.717-7.276s-.438-.876-.438-2.172c0-2.036 1.181-3.56 2.649-3.56 1.249 0 1.854.937 1.854 2.06 0 1.255-.8 3.133-1.213 4.874-.344 1.455.729 2.638 2.164 2.638 2.596 0 4.35-3.33 4.35-7.275 0-3.002-2.02-5.25-5.672-5.25-4.13 0-6.695 3.083-6.695 6.51 0 1.183.348 2.017.895 2.659a.356.356 0 0 1 .083.34c-.092.377-.294 1.19-.334 1.357-.054.217-.18.262-.414.158-1.542-.632-2.263-2.33-2.263-4.238 0-3.153 2.664-6.933 7.96-6.933 4.248 0 7.046 3.083 7.046 6.39 0 4.384-2.434 7.668-5.998 7.668-1.199 0-2.329-.647-2.716-1.379l-.758 2.915c-.238.888-.769 1.776-1.177 2.457A12 12 0 1 0 12 0z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .379.377 1.008.561 1.924.561l.008.002.008-.002c.915 0 1.544-.184 1.924-.561.085-.084.223-.084.307 0zm-3.44-2.418c0-.507-.414-.919-.922-.919-.509 0-.923.412-.923.919 0 .506.414.918.923.918.508.001.922-.411.922-.918zm13.202-.93c0 6.627-5.373 12-12 12s-12-5.373-12-12 5.373-12 12-12 12 5.373 12 12zm-5-.129c0-.851-.695-1.543-1.55-1.543-.417 0-.795.167-1.074.435-1.056-.695-2.485-1.137-4.066-1.194l.865-2.724 2.343.549-.003.034c0 .696.569 1.262 1.268 1.262.699 0 1.267-.566 1.267-1.262s-.568-1.262-1.267-1.262c-.537 0-.994.335-1.179.804l-2.525-.592c-.11-.027-.223.037-.257.145l-.965 3.038c-1.656.02-3.155.466-4.258 1.181-.277-.255-.644-.415-1.05-.415-.854.001-1.549.693-1.549 1.544 0 .566.311 1.056.768 1.325-.03.164-.05.331-.05.5 0 2.281 2.805 4.137 6.253 4.137s6.253-1.856 6.253-4.137c0-.16-.017-.317-.044-.472.486-.261.82-.766.82-1.353zm-4.872.141c-.509 0-.922.412-.922.919 0 .506.414.918.922.918s.922-.412.922-.918c0-.507-.413-.919-.922-.919z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  youtube: <YouTubeIcon />,
  tiktok: <TikTokIcon />,
  instagram: <InstagramIcon />,
  x: <XIcon />,
  pinterest: <PinterestIcon />,
  reddit: <RedditIcon />,
  google: <GoogleIcon />,
  getty: <GettyIcon />,
  midjourney: <MidjourneyIcon />,
};

// Ids must match lib/monitor/platforms.ts so hit platforms map onto rows.
const INITIAL_PLATFORMS: Omit<Platform, "status">[] = [
  { id: "instagram",  name: "Instagram Reels",      category: "Video",  icon: <InstagramIcon />,  checkDuration: 800  },
  { id: "tiktok",     name: "TikTok",               category: "Video",  icon: <TikTokIcon />,     checkDuration: 700  },
  { id: "youtube",    name: "YouTube Shorts",       category: "Video",  icon: <YouTubeIcon />,    checkDuration: 900  },
  { id: "x",          name: "X (Twitter)",          category: "Social", icon: <XIcon />,          checkDuration: 600  },
  { id: "pinterest",  name: "Pinterest",            category: "Social", icon: <PinterestIcon />,  checkDuration: 500  },
  // Reddit sweeps include adult communities — that's where likeness misuse
  // concentrates, and the badge says so up front rather than surprising the
  // talent with what the hits contain.
  { id: "reddit",     name: "Reddit",               category: "Social", icon: <RedditIcon />,     checkDuration: 650, badge: "NSFW" },
  { id: "google",     name: "Google Images",        category: "Search", icon: <GoogleIcon />,     checkDuration: 1100 },
  { id: "getty",      name: "Getty / Shutterstock", category: "Stock",  icon: <GettyIcon />,      checkDuration: 750  },
  { id: "midjourney", name: "AI Platforms",         category: "AI Gen", icon: <MidjourneyIcon />, checkDuration: 1300 },
];

const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  INITIAL_PLATFORMS.map((p) => [p.id, p.name])
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(unix: number): string {
  const diff = Date.now() - unix * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// One chip for both places NSFW appears: the standing coverage note on the
// Reddit sweep row and the per-hit warning on flagged content. Solid ink so
// it reads as a label, not another severity level competing with RISK_COLORS.
function NsfwBadge({ label = "NSFW" }: { label?: string }) {
  return (
    <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>
      {label}
    </span>
  );
}

const RISK_COLORS: Record<string, { bg: string; fg: string }> = {
  low: { bg: "rgba(107,114,128,0.12)", fg: "#6b7280" },
  medium: { bg: "rgba(217,119,6,0.12)", fg: "#d97706" },
  high: { bg: "rgba(239,68,68,0.12)", fg: "#dc2626" },
  critical: { bg: "rgba(127,29,29,0.15)", fg: "#7f1d1d" },
};

const HIT_STATUS_LABELS: Record<string, string> = {
  new: "New",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
  takedown_requested: "Takedown requested",
  resolved: "Resolved",
};

// ── Status badge ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ScanStatus }) {
  if (status === "idle") return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>Idle</span>
  );
  if (status === "checking") return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      Scanning
    </span>
  );
  if (status === "clear") return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      Clear
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}>
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Flagged
    </span>
  );
}

// ── Platform row ────────────────────────────────────────────────────────────

function PlatformRow({ platform }: { platform: Platform }) {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b last:border-0"
      style={{ borderColor: "var(--color-border)" }}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}>
        {platform.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {platform.name}
          {platform.badge && <NsfwBadge label={platform.badge} />}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{platform.category}</p>
      </div>
      <StatusPill status={platform.status} />
    </div>
  );
}

// ── Identity card ───────────────────────────────────────────────────────────

function IdentityBadge({ identity }: { identity: TalentIdentityForMonitor }) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border px-4 py-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {identity.profileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={identity.profileImageUrl}
          alt={identity.fullName}
          className="h-10 w-[27px] shrink-0 rounded-sm object-cover object-top"
        />
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: "var(--color-ink)" }}
        >
          {identity.fullName.split(" ").map((p) => p[0]).join("").slice(0, 2)}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
            {identity.fullName}
          </p>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ background: "rgba(1,180,228,0.1)", color: "#01b4e4" }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Identity Verified
          </span>
        </div>
        {identity.knownFor.length > 0 && (
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-muted)" }}>
            {identity.knownFor.slice(0, 3).map((k) => k.title).join(" · ")}
          </p>
        )}
      </div>

      <p className="shrink-0 text-xs" style={{ color: "var(--color-muted)" }}>
        Monitoring target
      </p>
    </div>
  );
}

// ── Detection coverage ──────────────────────────────────────────────────────

const TIER_LABELS: Record<ReferenceSetState["coverage"]["tier"], { label: string; color: string }> = {
  unanchored: { label: "Unanchored", color: "#d97706" },
  baseline: { label: "Baseline", color: "#6b7280" },
  anchored: { label: "Vault-anchored", color: "var(--color-accent)" },
  fortified: { label: "Fortified", color: "#16a34a" },
};

/**
 * The flywheel card: how much of the talent's vault is strengthening the
 * monitor, and which scan to add next.
 *
 * Deliberately says nothing about what detection leans on when coverage is
 * thin — the talent's own dashboard is not the place to publish where the
 * monitor is weakest. It states what they have, the type of scan that would
 * help next, and that adding it makes monitoring more effective.
 */
function DetectionCoverageCard({ refSet }: { refSet: ReferenceSetState }) {
  const tier = TIER_LABELS[refSet.coverage.tier];
  const vault = refSet.vaultPackages ?? { total: 0, faceCount: 0, bodyCount: 0 };
  const parts: string[] = [];
  if (vault.faceCount > 0) parts.push("face");
  if (vault.bodyCount > 0) parts.push("full-body");

  const summary =
    vault.total === 0
      ? "No scans in your vault yet — adding one makes monitoring more effective."
      : `${vault.total} scan package${vault.total === 1 ? "" : "s"} in your vault` +
        (parts.length ? ` — ${parts.join(" and ")} captures.` : ".");

  return (
    <div className="rounded-md border px-5 py-4 space-y-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Detection coverage
        </p>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: tier.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tier.color }} />
          {tier.label}
        </span>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {summary}
          </p>
          <p className="text-xs font-semibold shrink-0" style={{ color: "var(--color-ink)" }}>
            {refSet.coverage.score}/100
          </p>
        </div>
        <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${refSet.coverage.score}%`, background: tier.color }} />
        </div>
        {(refSet.phashIndexedCount ?? 0) > 0 && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
            Derivation index: {refSet.phashIndexedCount} still{refSet.phashIndexedCount === 1 ? "" : "s"} fingerprinted —
            reposts and edits of your vault imagery are matched directly.
          </p>
        )}
      </div>

      {refSet.coverage.improvements.length > 0 && (
        <div className="space-y-1.5">
          {refSet.coverage.improvements.slice(0, 2).map((text) => (
            <div key={text} className="flex items-start gap-2">
              <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>{text}</p>
            </div>
          ))}
          <Link
            href="/dashboard?upload=1"
            className="inline-block text-xs font-medium underline underline-offset-2"
            style={{ color: "var(--color-accent)" }}
          >
            Add scans to your vault →
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Hit card ────────────────────────────────────────────────────────────────

function ConfidenceBar({ value, label }: { value: number; label: string }) {
  const color = value >= 85 ? "#dc2626" : value >= 65 ? "#d97706" : "#6b7280";
  return (
    <div className="flex-1 min-w-[130px]">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>{label}</p>
        <p className="text-xs font-semibold" style={{ color }}>{value}%</p>
      </div>
      <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

/**
 * Row of small round headshots for every additional actor identified in a
 * hit's media. Deliberately neutral: whether or not a given actor is on
 * ImageVault is not surfaced here — that would leak roster membership to
 * every talent viewing their own hits. Onboarded vs non-onboarded gets
 * tracked internally on the row (talentId is null for non-onboarded) and
 * exposed only to admins on the funnel-candidates panel.
 */
function SecondaryActorStack({ actors }: { actors: SecondaryActor[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <p
        className="text-[10px] uppercase tracking-widest font-semibold"
        style={{ color: "var(--color-muted)" }}
      >
        Also in this content
      </p>
      <div className="flex -space-x-2">
        {actors.slice(0, 6).map((actor, i) => (
          <SecondaryAvatar key={i} actor={actor} />
        ))}
        {actors.length > 6 && (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{
              background: "var(--color-surface)",
              border: "2px solid var(--color-bg)",
              color: "var(--color-muted)",
            }}
          >
            +{actors.length - 6}
          </div>
        )}
      </div>
      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        {actors.length} actor{actors.length === 1 ? "" : "s"} identified
      </span>
    </div>
  );
}

function SecondaryAvatar({ actor }: { actor: SecondaryActor }) {
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
      className="relative h-7 w-7 rounded-full overflow-hidden"
      style={{
        border: `2px solid var(--color-bg)`,
        boxShadow: `0 0 0 1.5px var(--color-border)`,
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
          className="flex h-full w-full items-center justify-center text-[10px] font-semibold"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {initials || "?"}
        </div>
      )}
    </div>
  );
}

/**
 * Preview a flagged hit inline via the platform's iframe embed endpoint.
 *
 * Two design choices worth calling out:
 *  1. Embeds are iframed directly at the platform, not proxied through us.
 *     Proxying would require rebroadcasting the platform's video which
 *     invites hosting-liability questions and doubles bandwidth cost. The
 *     iframe scoping matches how any Instagram embed on any site works —
 *     the platform's cookies stay first-party, ours never touch the frame.
 *  2. Fallback for X and unknown hosts: we surface the platform link and a
 *     one-line reason ("this platform blocks iframe embedding"). Silent
 *     failure would leave the modal empty with no explanation for the
 *     talent about why we can't render the content in place.
 */
function HitPreviewModal({ hit, onClose }: { hit: LikenessHit; onClose: () => void }) {
  const embed = embedInfoFor(hit.contentUrl);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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
        className="relative rounded-lg overflow-hidden flex flex-col max-h-full"
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          width: embed?.aspectRatio === "16/9" ? "min(880px, 100%)" : "min(420px, 100%)",
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-2"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="min-w-0">
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {PLATFORM_LABELS[hit.platform] ?? hit.platform}
              {hit.authorHandle ? ` · ${hit.authorHandle}` : ""}
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

        {embed ? (
          <div
            className="relative w-full"
            style={{ aspectRatio: embed.aspectRatio.replace("/", " / ") }}
          >
            <iframe
              src={embed.embedUrl}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; encrypted-media; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="p-6 text-center space-y-3">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              This platform blocks iframe embedding, so it can&apos;t be shown here.
            </p>
            <a
              href={hit.contentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
            >
              Open on platform →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dismiss control for a hit. The reason list and its free-text "other" branch
 * live in the shared ReasonMenu, which positions itself against the viewport —
 * the hit card clips its own overflow for the platform accent edge, and an
 * absolutely-positioned dropdown was getting cut off at the card boundary.
 *
 * Structured reasons feed the admin tuning panel: a hit dropped as `not_ai` is
 * a different tuning signal than one dropped as `not_me`, and merging them
 * costs us insight into the pre-filter's real error mix.
 */
const DISMISS_OPTIONS: ReasonOption[] = [
  { reason: "not_me", label: "Not me" },
  { reason: "not_misuse", label: "Not misuse" },
  { reason: "not_ai", label: "Not AI" },
  { reason: "other", label: "Other\u2026" },
];

function DismissMenu({
  hitId,
  onDismiss,
  busy,
}: {
  hitId: string;
  onDismiss: (id: string, status: string, extra?: { dismissalReason?: string; dismissalNotes?: string }) => void;
  busy: boolean;
}) {
  return (
    <ReasonMenu
      triggerLabel="Dismiss"
      options={DISMISS_OPTIONS}
      busy={busy}
      width={208}
      notesPlaceholder="Why is this being dismissed?"
      confirmLabel="Dismiss"
      onPick={(reason, notes) =>
        onDismiss(hitId, "dismissed", {
          dismissalReason: reason,
          ...(notes ? { dismissalNotes: notes } : {}),
        })
      }
    />
  );
}

function HitCard({ hit, onTriage, onPreview, busy }: {
  hit: LikenessHit;
  onTriage: (id: string, status: string, extra?: { dismissalReason?: string; dismissalNotes?: string }) => void;
  onPreview: (hit: LikenessHit) => void;
  busy: boolean;
}) {
  const risk = RISK_COLORS[hit.riskLevel] ?? RISK_COLORS.medium;
  const open = hit.status === "new" || hit.status === "confirmed";
  const brand = platformBrand(hit.platform);

  // Match signals and the adjudicator note fold away so a page of hits reads
  // as a scannable list. Two things deliberately stay out of the fold: the
  // triage actions, because acting on a hit shouldn't cost an extra click, and
  // the other actors identified in the content — a row of faces is the part
  // that makes someone look twice, and hiding it wastes the card's best
  // moment.
  const [expanded, setExpanded] = useState(false);
  const detailParts: string[] = [];
  if (hit.matchSignals.length) {
    detailParts.push(`${hit.matchSignals.length} match signal${hit.matchSignals.length === 1 ? "" : "s"}`);
  }
  if (hit.aiRationale) detailParts.push("adjudicator note");
  const hasDetail = detailParts.length > 0;
  return (
    <div className="relative overflow-hidden rounded-md border p-4 pl-5 space-y-3"
      style={{ borderColor: hit.status === "new" ? "rgba(239,68,68,0.35)" : "var(--color-border)", background: "var(--color-bg)" }}>
      {/* Platform accent edge — the one brand element each card carries. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: brand.edge }} />
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ background: brand.tint, color: brand.color }}>
          {PLATFORM_ICONS[hit.platform] ?? <GettyIcon />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              {PLATFORM_LABELS[hit.platform] ?? hit.platform}
            </p>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>{hit.authorHandle}</span>
            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: risk.bg, color: risk.fg }}>
              {hit.riskLevel}
            </span>
            {hit.nsfw && <NsfwBadge />}
            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>
              {HIT_STATUS_LABELS[hit.status] ?? hit.status}
            </span>
          </div>
          {hit.caption && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--color-muted)" }}>
              &ldquo;{hit.caption}&rdquo;
            </p>
          )}
        </div>
        <p className="shrink-0 text-xs" style={{ color: "var(--color-muted)" }}>{formatRelative(hit.detectedAt)}</p>
      </div>

      <div className="flex gap-6 flex-wrap">
        <ConfidenceBar value={hit.confidence} label="Likeness match" />
        <ConfidenceBar value={hit.aiGeneratedLikelihood} label="AI-generated" />
      </div>

      {hit.secondaryActors && hit.secondaryActors.length > 0 && (
        <SecondaryActorStack actors={hit.secondaryActors} />
      )}

      {hasDetail && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium"
          style={{ color: "var(--color-muted)" }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {expanded ? "Hide detail" : detailParts.join(" · ")}
        </button>
      )}

      {expanded && hit.matchSignals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hit.matchSignals.map((s, i) => (
            <span key={i} className="rounded px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>
              {s}
            </span>
          ))}
        </div>
      )}

      {expanded && hit.aiRationale && (
        <p className="text-xs leading-relaxed rounded px-3 py-2"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}>
          <span className="font-semibold" style={{ color: "var(--color-ink)" }}>Adjudicator: </span>
          {hit.aiRationale}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onPreview(hit)}
          className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Preview
        </button>
        <a href={hit.contentUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open on platform
        </a>
        {open && hit.status !== "takedown_requested" && (
          <button
            onClick={() => onTriage(hit.id, "takedown_requested")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-60"
            style={{ background: "#c0392b" }}
          >
            Request takedown
          </button>
        )}
        {hit.status === "new" && (
          <DismissMenu hitId={hit.id} onDismiss={onTriage} busy={busy} />
        )}
        {hit.status === "takedown_requested" && (
          <button
            onClick={() => onTriage(hit.id, "resolved")}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60"
            style={{ borderColor: "var(--color-border)", color: "#16a34a" }}
          >
            Mark resolved
          </button>
        )}
      </div>
    </div>
  );
}

// ── Review queue ────────────────────────────────────────────────────────────

/**
 * Count up to the figure once it lands.
 *
 * The queue numbers come from two fetches, so the tile sits on zeros for a
 * beat and then snaps — which reads as a glitch. Ticking up from zero over
 * half a second covers the gap and makes the arrival deliberate. Honours
 * prefers-reduced-motion by jumping straight to the value.
 */
function useCountUp(target: number, ready: boolean, duration = 550): number {
  const [value, setValue] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const from = shownRef.current;
    // Reduced motion runs the same loop with a zero-length ramp, so the first
    // frame lands on the target. Everything still happens inside the frame
    // callback rather than synchronously in the effect.
    const span = reduced ? 0 : duration;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = span === 0 ? 1 : Math.min(1, (now - start) / span);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * eased);
      shownRef.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ready, duration]);

  return value;
}

function QueueStat({
  value,
  label,
  ready,
  accent,
  format = String,
}: {
  value: number;
  label: string;
  ready: boolean;
  accent?: boolean;
  format?: (n: number) => string;
}) {
  const shown = useCountUp(value, ready);
  return (
    <div>
      <p
        className="font-mono text-2xl leading-none tabular-nums transition-opacity"
        style={{
          color: accent && value > 0 ? "var(--color-accent)" : "var(--color-ink)",
          opacity: ready ? 1 : 0.25,
        }}
      >
        {ready ? format(shown) : "\u2014"}
      </p>
      <p className="mt-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * Hits waiting on the talent and the accounts publishing them, in one place.
 *
 * These were two separate things: a status strip counting unreviewed hits, and
 * a small text link to the accounts screen buried under the page title. The
 * accounts view is where the actual enforcement decisions get made — an
 * account is what has to be shut down, individual posts are cheap to repost —
 * so it gets a real tile and a real button rather than an anonymous link.
 */
function ReviewQueueCard({
  newCount,
  openCount,
  accounts,
  loaded,
  accountsLoaded,
  name,
}: {
  newCount: number;
  openCount: number;
  accounts: OffenderAccountSummary[];
  loaded: boolean;
  accountsLoaded: boolean;
  name: string;
}) {
  const activeAccounts = accounts.filter((a) => a.status === "watchlist" || a.status === "reported");
  const reach = activeAccounts.reduce((sum, a) => sum + (a.cumulativeViews ?? 0), 0);
  const reported = accounts.filter((a) => a.status === "reported").length;
  const empty = newCount === 0 && openCount === 0 && activeAccounts.length === 0;
  const settled = loaded && accountsLoaded;

  return (
    <div
      className="rounded-md border overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Review queue
          </p>
          {newCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: "rgba(239,68,68,0.12)", color: "#dc2626" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              Needs you
            </span>
          )}
        </div>

        {empty && settled ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Nothing waiting on you. Run a scan to check the monitored platforms for unauthorised use of{" "}
            {name}.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <QueueStat
              value={newCount}
              ready={loaded}
              label={`hit${newCount === 1 ? "" : "s"} awaiting review`}
              accent
            />
            <QueueStat value={openCount} ready={loaded} label="open cases" />
            <QueueStat value={activeAccounts.length} ready={accountsLoaded} label="accounts in play" />
            <QueueStat
              value={reach}
              ready={accountsLoaded}
              label="views to remove"
              format={formatCompact}
            />
          </div>
        )}
      </div>

      <div
        className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg)" }}
      >
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {activeAccounts.length > 0
            ? `${activeAccounts.length} account${activeAccounts.length === 1 ? "" : "s"} publishing this content` +
              (reported > 0 ? ` · ${reported} reported to the platform` : "")
            : "Accounts are opened as case files the first time a sweep flags a post."}
        </p>
        <Link
          href="/vault/monitor/accounts"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white transition shrink-0"
          style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
        >
          View accounts
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  identity: TalentIdentityForMonitor | null;
}

export default function MonitorClient({ identity }: Props) {
  const [platforms, setPlatforms] = useState<Platform[]>(
    INITIAL_PLATFORMS.map((p) => ({ ...p, status: "idle" as ScanStatus }))
  );
  // Admin platform toggles, from /api/monitor. Null until first load — the
  // full registry renders as a sensible placeholder in the meantime.
  const [enabledIds, setEnabledIds] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [hits, setHits] = useState<LikenessHit[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [monitor, setMonitor] = useState<MonitorConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [triaging, setTriaging] = useState<string | null>(null);
  const [previewHit, setPreviewHit] = useState<LikenessHit | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Scan id currently being polled — by runScan or by the resume effect after
  // a page reload — so the two never double-track the same sweep.
  const trackingScanRef = useRef<string | null>(null);
  const [refSet, setRefSet] = useState<ReferenceSetState | null>(null);
  const [accounts, setAccounts] = useState<OffenderAccountSummary[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  const name = identity?.fullName ?? "your likeness";

  const refresh = useCallback(async () => {
    try {
      // Coverage rides along with every state refresh: a sweep re-syncs the
      // reference set server-side, so post-scan refreshes pick up new scans.
      void fetch("/api/monitor/reference-set")
        .then((r) => (r.ok ? (r.json() as Promise<ReferenceSetState>) : null))
        .then((data) => data && setRefSet(data))
        .catch(() => {});

      // Offender accounts feed the review-queue tile's second half. Non-fatal:
      // the tile degrades to hit counts if this fails.
      void fetch("/api/monitor/accounts")
        .then((r) => (r.ok ? (r.json() as Promise<{ accounts: OffenderAccountSummary[] }>) : null))
        .then((data) => data && setAccounts(data.accounts))
        .finally(() => setAccountsLoaded(true))
        .catch(() => {});

      const res = await fetch("/api/monitor");
      if (!res.ok) return;
      const data = (await res.json()) as MonitorState;
      setHits(data.hits);
      setScans(data.scans);
      setMonitor(data.monitor);

      // The panel only lists platforms the admin has switched on — showing a
      // surface we are not sweeping as "clear" would claim coverage we don't
      // have. Falls back to the full registry if the API predates the field.
      const enabled = data.enabledPlatforms?.length
        ? INITIAL_PLATFORMS.filter((p) => data.enabledPlatforms!.includes(p.id))
        : INITIAL_PLATFORMS;
      setEnabledIds(enabled.map((p) => p.id));

      // Reconstruct the platform panel from persisted state, so a page reload
      // (or a scan triggered from another surface) still reflects reality —
      // otherwise the animation in runScan() is the only thing that ever
      // populates it, and the panel misreports "0 checked" whenever the
      // user opens the page cold.
      const lastCompleteScan = data.scans.find((s) => s.status === "complete");
      const platformsWithHits = new Set(data.hits.map((h) => h.platform));
      setPlatforms(
        enabled.map((p) => ({
          ...p,
          status: lastCompleteScan
            ? platformsWithHits.has(p.id)
              ? ("flagged" as ScanStatus)
              : ("clear" as ScanStatus)
            : ("idle" as ScanStatus),
        }))
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll a sweep until it settles. A sweep chains several 1-3 minute Apify
  // runs and the server marks runs dead after 15 minutes, so this outlasts
  // that timeout (~18 minutes) — a scan can no longer "time out" client-side
  // while it is genuinely still running. Past the typical duration it swaps
  // the spinner copy for a note instead of giving up.
  const pollScan = useCallback(async (scanId: string): Promise<ScanResponse> => {
    for (let attempt = 0; attempt < 220; attempt++) {
      await new Promise((r) => setTimeout(r, attempt < 5 ? 1_000 : attempt < 100 ? 3_000 : 6_000));
      if (attempt === 100) {
        setScanNote(
          "Still sweeping — large sweeps can take up to 15 minutes. You can leave this page; the scan keeps running and results will be here when you return."
        );
      }
      const poll = await fetch(`/api/monitor/scans/${scanId}`);
      if (!poll.ok) continue;
      const scan = (await poll.json()) as ScanResponse;
      if (scan.status === "complete") return scan;
      if (scan.status === "error") throw new Error(scan.error ?? "Scan failed");
    }
    throw new Error("Lost track of the sweep — refresh the page to see where it got to.");
  }, []);

  const runScan = useCallback(async () => {
    if (scanning) return;

    setScanning(true);
    setLastResult(null);
    setScanError(null);
    setScanNote(null);
    const activePlatforms = enabledIds
      ? INITIAL_PLATFORMS.filter((p) => enabledIds.includes(p.id))
      : INITIAL_PLATFORMS;
    setPlatforms(activePlatforms.map((p) => ({ ...p, status: "idle" as ScanStatus })));

    // Kick off the sweep. Discovery runs against live platforms and takes
    // minutes, so the POST only opens the scan — the result arrives by polling.
    // The per-platform animation runs alongside as progress texture, but it no
    // longer decides when the scan is finished.
    const request = (async () => {
      const res = await fetch("/api/monitor/scan", { method: "POST" });
      if (res.status === 409) {
        // A sweep is already mid-flight (started elsewhere, or this page's
        // state was stale) — attach to it rather than reporting an error.
        const body = (await res.json().catch(() => ({}))) as { error?: string; scanId?: string };
        if (body.scanId) {
          trackingScanRef.current = body.scanId;
          return pollScan(body.scanId);
        }
        throw new Error(body.error ?? "A scan is already in progress");
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Scan failed");
      }
      const { scanId } = (await res.json()) as { scanId: string };
      trackingScanRef.current = scanId;
      return pollScan(scanId);
    })();

    const animation = (async () => {
      for (const platform of activePlatforms) {
        setPlatforms((prev) =>
          prev.map((p) => (p.id === platform.id ? { ...p, status: "checking" } : p))
        );
        await new Promise((r) => setTimeout(r, platform.checkDuration));
        setPlatforms((prev) =>
          prev.map((p) => (p.id === platform.id ? { ...p, status: "clear" } : p))
        );
        await new Promise((r) => setTimeout(r, 180));
      }
    })();

    try {
      const [result] = await Promise.all([request, animation]);
      const hitPlatforms = new Set(result.newHits.map((h) => h.platform));
      setPlatforms((prev) =>
        prev.map((p) => (hitPlatforms.has(p.id) ? { ...p, status: "flagged" } : p))
      );
      setLastResult(result);
      setHits((prev) => [...result.newHits, ...prev]);
      await refresh();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
      setScanNote(null);
    }
  }, [scanning, refresh, enabledIds, pollScan]);

  // Resume tracking a sweep that is already running — one triggered before a
  // page reload, or from another tab. Without this, a reload mid-sweep lost
  // the spinner and the result silently; now the page picks the sweep back up
  // and finishes it on screen.
  useEffect(() => {
    const running = scans.find((s) => s.status === "running");
    if (!running || scanning || trackingScanRef.current === running.id) return;
    trackingScanRef.current = running.id;
    setScanning(true);
    setScanNote(`A sweep started ${formatRelative(running.startedAt)} is still running — results will appear here when it completes.`);
    setPlatforms((prev) => prev.map((p) => ({ ...p, status: "checking" as ScanStatus })));

    void (async () => {
      try {
        const result = await pollScan(running.id);
        const hitPlatforms = new Set(result.newHits.map((h) => h.platform));
        setPlatforms((prev) =>
          prev.map((p) => (hitPlatforms.has(p.id) ? { ...p, status: "flagged" } : { ...p, status: "clear" }))
        );
        setLastResult(result);
        await refresh();
      } catch (err) {
        setScanError(err instanceof Error ? err.message : "Scan failed");
        await refresh();
      } finally {
        setScanning(false);
        setScanNote(null);
      }
    })();
  }, [scans, scanning, pollScan, refresh]);

  const triageHit = useCallback(async (id: string, status: string, extra?: { dismissalReason?: string; dismissalNotes?: string }) => {
    setTriaging(id);
    try {
      const res = await fetch(`/api/monitor/hits/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (res.ok) {
        setHits((prev) => prev.map((h) => (h.id === id ? { ...h, status } : h)));
      }
    } finally {
      setTriaging(null);
    }
  }, []);

  const toggleMonitor = useCallback(async () => {
    if (!monitor) return;
    const next = monitor.status === "active" ? "paused" : "active";
    setMonitor({ ...monitor, status: next });
    await fetch("/api/monitor", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
  }, [monitor]);

  const openHits = hits.filter((h) => h.status === "new" || h.status === "confirmed" || h.status === "takedown_requested");
  const closedHits = hits.filter((h) => h.status === "dismissed" || h.status === "resolved");
  const newCount = hits.filter((h) => h.status === "new").length;
  const scanClean = lastResult !== null && lastResult.newHits.length === 0;
  const lastScanAt = monitor?.lastScanAt ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Likeness Monitor
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            AI-adjudicated scanning of public platforms for unauthorised use of{" "}
            <span className="font-medium" style={{ color: "var(--color-ink)" }}>{name}</span>.
          </p>
        </div>

        <button
          onClick={runScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white transition disabled:opacity-60 shrink-0"
          style={{
            background: scanning ? "var(--color-muted)" : "var(--color-ink)",
            borderRadius: "var(--radius)",
          }}
        >
          {scanning ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Scanning…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Run Scan
            </>
          )}
        </button>
      </div>

      {/* ── Identity badge ── */}
      {identity && <IdentityBadge identity={identity} />}

      {/* ── Review queue: hits awaiting review + the accounts behind them ── */}
      <ReviewQueueCard
        newCount={newCount}
        openCount={openHits.length}
        accounts={accounts}
        accountsLoaded={accountsLoaded}
        loaded={loaded}
        name={name}
      />

      {/* ── Detection coverage (vault-anchored reference set) ── */}
      {refSet && <DetectionCoverageCard refSet={refSet} />}

      {/* ── Monitor status strip ── */}
      {monitor && (
        <div className="flex items-center justify-between rounded-md border px-4 py-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full"
              style={{ background: monitor.status === "active" ? "#16a34a" : "#d97706" }} />
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Continuous monitoring{" "}
              <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                {monitor.status === "active" ? "active" : "paused"}
              </span>
              {lastScanAt ? ` · last sweep ${formatRelative(lastScanAt)}` : ""}
            </p>
          </div>
          <button onClick={toggleMonitor} className="text-xs font-medium underline underline-offset-2"
            style={{ color: "var(--color-muted)" }}>
            {monitor.status === "active" ? "Pause" : "Resume"}
          </button>
        </div>
      )}

      {/* ── Status banner ── */}
      {scanNote && !scanError && (
        <div className="flex items-center gap-3 rounded-md border px-5 py-4"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
          <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>{scanNote}</p>
        </div>
      )}

      {scanError && (
        <div className="flex items-center gap-4 rounded-md border px-5 py-4"
          style={{ background: "rgba(217,119,6,0.06)", borderColor: "rgba(217,119,6,0.25)" }}>
          <p className="text-sm font-medium" style={{ color: "#d97706" }}>{scanError}</p>
        </div>
      )}

      {lastResult && lastResult.newHits.length > 0 && (
        <div className="flex items-center gap-4 rounded-md border px-5 py-4"
          style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.3)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(239,68,68,0.12)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#dc2626" }}>
              {lastResult.newHits.length === 1
                ? `1 new likeness hit detected for ${name}`
                : `${lastResult.newHits.length} new likeness hits detected for ${name}`}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {lastResult.candidatesAnalysed} candidates analysed across {lastResult.platformsChecked} platforms.
              You{identity ? " and your reps" : ""} have been alerted by email and in-app notification — review below.
            </p>
          </div>
        </div>
      )}

      {scanClean && (
        <div className="flex items-center gap-4 rounded-md border px-5 py-4"
          style={{ background: "rgba(34,197,94,0.07)", borderColor: "rgba(34,197,94,0.25)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(34,197,94,0.12)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#16a34a" }}>
              No unauthorised usage detected for {name}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {lastResult?.candidatesAnalysed ?? 0} candidates cleared by the adjudicator across all {platforms.length} monitored platforms.
              {lastScanAt && ` Last scanned ${formatRelative(lastScanAt)}.`}
            </p>
          </div>
        </div>
      )}

      {scanning && (
        <div className="flex items-center gap-4 rounded-md border px-5 py-4"
          style={{ background: "rgba(59,130,246,0.06)", borderColor: "rgba(59,130,246,0.2)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(59,130,246,0.1)" }}>
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "#3b82f6" }}>Scan in progress</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              Cross-referencing {name}&apos;s biometric signature across {platforms.length} platforms, then adjudicating candidates with the vault&apos;s AI reasoning layer.
            </p>
          </div>
        </div>
      )}

      {/* ── Detected hits ── */}
      {loaded && openHits.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Detected hits
          </p>
          <div className="space-y-3">
            {openHits.map((hit) => (
              <HitCard key={hit.id} hit={hit} onTriage={triageHit} onPreview={setPreviewHit} busy={triaging === hit.id} />
            ))}
          </div>
        </div>
      )}

      {/* ── Platform grid ── */}
      <div className="rounded-md border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
        <div className="px-5 py-3.5 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Monitored platforms
          </p>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>
            {platforms.filter((p) => p.status === "clear" || p.status === "flagged").length}/{platforms.length} checked
          </span>
        </div>
        <div className="px-5" style={{ background: "var(--color-bg)" }}>
          {platforms.map((platform) => (
            <PlatformRow key={platform.id} platform={platform} />
          ))}
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="rounded-md border px-5 py-5 space-y-3"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          How it works
        </p>
        <div className="space-y-2.5">
          {[
            {
              step: "1",
              text: `We take a fingerprint of ${name}'s scan — a mathematical signature, not the images themselves.`,
            },
            {
              step: "2",
              text: "New public media on each platform is checked against that fingerprint. The scan never leaves the vault.",
            },
            {
              step: "3",
              text: "Anything close gets a second look from the AI review layer, which clears genuine archival footage and flags likely misuse, with its reasoning on the record.",
            },
            {
              step: "4",
              text: "A confirmed match alerts you and your reps and drafts a takedown or licence request for your approval — nothing is actioned without your say-so.",
            },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
              >
                {step}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scan history ── */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
          Scan history
        </p>
        <div className="rounded-md border divide-y overflow-hidden"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
          {scans.length === 0 && (
            <p className="px-5 py-4 text-sm" style={{ color: "var(--color-muted)" }}>No scans run yet.</p>
          )}
          {scans.map((record) => (
            <div key={record.id} className="flex items-center justify-between px-5 py-3.5"
              style={{ borderColor: "var(--color-border)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {record.status === "running"
                    ? "Sweep in progress…"
                    : record.status === "error"
                      ? "Sweep failed"
                      : record.hitsFound === 0
                        ? `Clean — no violations found for ${name}`
                        : `${record.hitsFound} violation${record.hitsFound === 1 ? "" : "s"} detected`}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {record.status === "running" ? (
                    <>Started {formatRelative(record.startedAt)} · {record.platformsChecked} platforms</>
                  ) : record.status === "error" ? (
                    <>{formatDate(record.startedAt)} · {record.error ?? "No error recorded"}</>
                  ) : (
                    <>
                      {formatDate(record.startedAt)} · {record.platformsChecked} platforms · {record.candidatesAnalysed} candidates
                      {record.aiProvider === "ai" ? " · AI adjudicated" : record.aiProvider === "heuristic" ? " · heuristic thresholds" : ""}
                    </>
                  )}
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={
                  record.status === "running"
                    ? { background: "rgba(217,119,6,0.10)", color: "#d97706" }
                    : record.status === "error"
                      ? { background: "rgba(107,114,128,0.10)", color: "var(--color-muted)" }
                      : record.hitsFound === 0
                        ? { background: "rgba(34,197,94,0.10)", color: "#16a34a" }
                        : { background: "rgba(239,68,68,0.10)", color: "#dc2626" }
                }
              >
                {record.status === "running" ? (
                  <>
                    <svg className="animate-spin" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Running
                  </>
                ) : record.status === "error" ? (
                  "Failed"
                ) : record.hitsFound === 0 ? (
                  <>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Clean
                  </>
                ) : "Flagged"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Resolved / dismissed archive ── */}
      {closedHits.length > 0 && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Closed hits
          </p>
          <div className="space-y-3 opacity-70">
            {closedHits.map((hit) => (
              <HitCard key={hit.id} hit={hit} onTriage={triageHit} onPreview={setPreviewHit} busy={triaging === hit.id} />
            ))}
          </div>
        </div>
      )}

      {previewHit && (
        <HitPreviewModal hit={previewHit} onClose={() => setPreviewHit(null)} />
      )}
    </div>
  );
}
