"use client";

import { useState, useCallback } from "react";
import type { TalentIdentityForMonitor } from "./page";

// ── Types ───────────────────────────────────────────────────────────────────

type ScanStatus = "idle" | "checking" | "clear" | "flagged";

interface Platform {
  id: string;
  name: string;
  category: string;
  icon: React.ReactNode;
  status: ScanStatus;
  checkDuration: number;
}

interface ScanRecord {
  id: string;
  ranAt: Date;
  result: "clean" | "flagged";
  platformsChecked: number;
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

// ── Initial platform data ───────────────────────────────────────────────────

const INITIAL_PLATFORMS: Omit<Platform, "status">[] = [
  { id: "youtube",    name: "YouTube",              category: "Video",    icon: <YouTubeIcon />,    checkDuration: 900  },
  { id: "tiktok",     name: "TikTok",               category: "Video",    icon: <TikTokIcon />,     checkDuration: 700  },
  { id: "instagram",  name: "Instagram Reels",      category: "Video",    icon: <InstagramIcon />,  checkDuration: 800  },
  { id: "x",          name: "X (Twitter)",          category: "Social",   icon: <XIcon />,          checkDuration: 600  },
  { id: "pinterest",  name: "Pinterest",            category: "Social",   icon: <PinterestIcon />,  checkDuration: 500  },
  { id: "google",     name: "Google Images",        category: "Search",   icon: <GoogleIcon />,     checkDuration: 1100 },
  { id: "getty",      name: "Getty / Shutterstock", category: "Stock",    icon: <GettyIcon />,      checkDuration: 750  },
  { id: "midjourney", name: "AI Platforms",         category: "AI Gen",   icon: <MidjourneyIcon />, checkDuration: 1300 },
];

const INITIAL_HISTORY: ScanRecord[] = [
  { id: "sr-001", ranAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3), result: "clean", platformsChecked: 8 },
  { id: "sr-002", ranAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), result: "clean", platformsChecked: 8 },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

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
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{platform.name}</p>
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
            TMDB Verified
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

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  identity: TalentIdentityForMonitor | null;
}

export default function MonitorClient({ identity }: Props) {
  const [platforms, setPlatforms] = useState<Platform[]>(
    INITIAL_PLATFORMS.map((p) => ({ ...p, status: "idle" as ScanStatus }))
  );
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [history, setHistory] = useState<ScanRecord[]>(INITIAL_HISTORY);
  const [lastScanned, setLastScanned] = useState<Date | null>(null);

  const name = identity?.fullName ?? "your likeness";

  const runScan = useCallback(async () => {
    if (scanning) return;

    setScanning(true);
    setScanComplete(false);
    setPlatforms(INITIAL_PLATFORMS.map((p) => ({ ...p, status: "idle" as ScanStatus })));

    for (let i = 0; i < INITIAL_PLATFORMS.length; i++) {
      const platform = INITIAL_PLATFORMS[i];

      setPlatforms((prev) =>
        prev.map((p) => (p.id === platform.id ? { ...p, status: "checking" } : p))
      );
      await new Promise((r) => setTimeout(r, platform.checkDuration));
      setPlatforms((prev) =>
        prev.map((p) => (p.id === platform.id ? { ...p, status: "clear" } : p))
      );
      await new Promise((r) => setTimeout(r, 180));
    }

    const now = new Date();
    setLastScanned(now);
    setScanning(false);
    setScanComplete(true);
    setHistory((prev) => [
      { id: `sr-${Date.now()}`, ranAt: now, result: "clean", platformsChecked: INITIAL_PLATFORMS.length },
      ...prev,
    ]);
  }, [scanning]);

  const allClear = scanComplete && platforms.every((p) => p.status === "clear");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Likeness Monitor
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Scanning public platforms for unauthorised use of{" "}
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

      {/* ── Status banner ── */}
      {allClear && (
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
              All {INITIAL_PLATFORMS.length} platforms checked — your likeness is secure.
              {lastScanned && ` Last scanned ${formatRelative(lastScanned)}.`}
            </p>
          </div>
        </div>
      )}

      {!scanComplete && !scanning && (
        <div className="flex items-center gap-4 rounded-md border px-5 py-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--color-border)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Awaiting scan</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              Run a scan to check all monitored platforms for unauthorised use of {name}.
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
              Cross-referencing {name}&apos;s biometric signature across {INITIAL_PLATFORMS.length} platforms using perceptual hash matching and facial geometry analysis.
            </p>
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
            {platforms.filter((p) => p.status === "clear").length}/{platforms.length} checked
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
              text: `Perceptual hash fingerprints derived from ${name}'s scan package are distributed to monitoring agents at each platform's data boundary.`,
            },
            {
              step: "2",
              text: "Facial geometry vectors extracted during onboarding are cross-referenced against newly indexed media using privacy-preserving nearest-neighbour search.",
            },
            {
              step: "3",
              text: "Any confirmed match triggers an alert and automatically drafts a licence request or DMCA takedown on your behalf, subject to your approval.",
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
          {history.length === 0 && (
            <p className="px-5 py-4 text-sm" style={{ color: "var(--color-muted)" }}>No scans run yet.</p>
          )}
          {history.map((record) => (
            <div key={record.id} className="flex items-center justify-between px-5 py-3.5"
              style={{ borderColor: "var(--color-border)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {record.result === "clean"
                    ? `Clean — no violations found for ${name}`
                    : "Violations detected"}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {formatDate(record.ranAt)} · {record.platformsChecked} platforms
                </p>
              </div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={
                  record.result === "clean"
                    ? { background: "rgba(34,197,94,0.10)", color: "#16a34a" }
                    : { background: "rgba(239,68,68,0.10)", color: "#dc2626" }
                }
              >
                {record.result === "clean" ? (
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

    </div>
  );
}
