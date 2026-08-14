"use client";

/**
 * /demo/monitor — auto-advancing tour of the Likeness Monitor.
 *
 * Five beats:
 *  1. Hits — reach-weighted list with secondary-actor avatar stack and confidence.
 *  2. Preview — in-app iframe modal on a flagged TikTok.
 *  3. Accounts — priority queue with Contact + Whitelist actions per offender.
 *  4. Contact — compose modal with a Licence-offer template.
 *  5. Admin — takedown backlog + cron controls (toggle, provider selector, Run now).
 *
 * Self-contained: no fetches, no D1, inline styles so it survives any theme
 * drift. Structure copied from /demo/production so the two feel of a piece.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";

const IsMobileContext = createContext(false);
const useIsMobile = () => useContext(IsMobileContext);

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType =
  | "hits-list"
  | "hit-preview"
  | "accounts-queue"
  | "contact-compose"
  | "admin-panel";

interface Scene {
  id: string;
  view: ViewType;
  role: "talent" | "admin";
  activeNav: "monitor" | "monitor-accounts" | "admin-monitor";
  headline: string;
  body: string;
}

const AUTO_MS = 10_000;
const INTRO_HOLD_MS = 2_000;
const INTRO_FADE_MS = 700;

// ─── Fake data ────────────────────────────────────────────────────────────────

const TALENT = {
  fullName: "Tom Hardy",
  initials: "TH",
  profileUrl: "https://image.tmdb.org/t/p/w185/4TpgnS6l8YUXSne9Av9nda6mjxY.jpg",
};

const SECONDARY_ACTORS = [
  { name: "Mads Mikkelsen", url: "https://image.tmdb.org/t/p/w185/AsX4bdvZ8UCayWTmAf9lAqOA8V7.jpg", confidence: 88 },
  { name: "John Cena", url: "https://image.tmdb.org/t/p/w185/rgB2eIOt7WyQjdgJCOuESdDlrjg.jpg", confidence: 84 },
  { name: "Channing Tatum", url: "https://image.tmdb.org/t/p/w185/prwdWq7iu9YMx8RENlZWNb6jVet.jpg", confidence: 92 },
];

interface FakeHit {
  handle: string;
  displayName: string;
  platform: "instagram" | "tiktok" | "youtube";
  caption: string;
  cumulativeViews: number;
  confidence: number;
  riskLevel: "medium" | "high";
  detectedRel: string;
  secondaries: number;
}

const HITS: FakeHit[] = [
  {
    handle: "@ultimatestudiosofficial",
    displayName: "Ultimate Studios",
    platform: "instagram",
    caption:
      "Anti-Venom (2027) – Tom Hardy, Mads Mikkelsen, John Cena | Concept Trailer. #AntiVenom #TomHardy #ai #conceptrailer",
    cumulativeViews: 4_857_092,
    confidence: 90,
    riskLevel: "high",
    detectedRel: "2h ago",
    secondaries: 3,
  },
  {
    handle: "@hardy.generates",
    displayName: "Hardy Generates",
    platform: "tiktok",
    caption:
      "❤️🔥 New Tom Hardy AI edit — Mad Max concept scene, all AI generated. #tomhardy #ai #veo3",
    cumulativeViews: 1_244_000,
    confidence: 90,
    riskLevel: "medium",
    detectedRel: "5h ago",
    secondaries: 0,
  },
  {
    handle: "@celeb_transform",
    displayName: "Celeb Transform",
    platform: "tiktok",
    caption:
      "Tom Hardy Was Born In Different Countries 🤯 #shorts #TomHardy #ai #celebrity #beforeafter",
    cumulativeViews: 383_400,
    confidence: 90,
    riskLevel: "medium",
    detectedRel: "1d ago",
    secondaries: 0,
  },
];

interface FakeAccount {
  handle: string;
  displayName: string;
  platform: "instagram" | "tiktok";
  cumulativeViews: number;
  hitCount: number;
  priorityScore: number;
  reason: string;
  lastSeen: string;
}

const OFFENDER_ACCOUNTS: FakeAccount[] = [
  {
    handle: "ultimatestudiosofficial",
    displayName: "Ultimate Studios",
    platform: "instagram",
    cumulativeViews: 4_857_092,
    hitCount: 4,
    priorityScore: 88,
    reason: "posted in the last 48h · 4 open hits",
    lastSeen: "2h ago",
  },
  {
    handle: "hardy.generates",
    displayName: "Hardy Generates",
    platform: "tiktok",
    cumulativeViews: 1_244_000,
    hitCount: 9,
    priorityScore: 74,
    reason: "posted in the last 48h · 9 open hits",
    lastSeen: "5h ago",
  },
  {
    handle: "celeb_transform",
    displayName: "Celeb Transform",
    platform: "tiktok",
    cumulativeViews: 383_400,
    hitCount: 2,
    priorityScore: 41,
    reason: "posted in the last week",
    lastSeen: "1d ago",
  },
];

const TAKEDOWN_TARGET = OFFENDER_ACCOUNTS[0];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const TALENT_NAV = [
  { id: "vault", label: "Vault" },
  { id: "requests", label: "Requests" },
  { id: "licences", label: "Licences" },
  { id: "monitor", label: "Monitor", active: true },
  { id: "settings", label: "Settings" },
];

const ADMIN_NAV = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "packages", label: "Packages" },
  { id: "monitor", label: "Monitor", active: true },
  { id: "audit", label: "Audit Log" },
];

function Sidebar({ role }: { role: "talent" | "admin" }) {
  const nav = role === "talent" ? TALENT_NAV : ADMIN_NAV;
  const user =
    role === "talent"
      ? { name: TALENT.fullName, subtitle: "Talent", initials: TALENT.initials }
      : { name: "Admin", subtitle: "Platform Admin", initials: "AD" };

  return (
    <aside
      style={{
        width: "14rem",
        flexShrink: 0,
        background: "#0a0a0a",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          height: "100%",
          padding: "2rem 0",
        }}
      >
        <div>
          <div style={{ padding: "0 1.5rem", marginBottom: "2.5rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "0.05em" }}>
              ImageVault
            </div>
            <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
            {role === "admin" && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.55rem",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  color: "#c0392b",
                }}
              >
                ADMIN
              </div>
            )}
          </div>
          <nav style={{ padding: "0 0.75rem" }}>
            {nav.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.625rem 0.75rem",
                  borderRadius: "0.25rem",
                  marginBottom: "0.125rem",
                  background: item.active ? "rgba(192,57,43,0.18)" : "transparent",
                  borderLeft: item.active ? "3px solid #c0392b" : "3px solid transparent",
                  color: item.active ? "#fff" : "rgba(255,255,255,0.45)",
                  fontSize: "0.875rem",
                  cursor: "default",
                }}
              >
                {item.label}
              </div>
            ))}
          </nav>
        </div>
        <div style={{ padding: "0 1.5rem" }}>
          <div
            style={{
              marginBottom: "1rem",
              display: "inline-block",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              padding: "0.2rem 0.5rem",
              background: "rgba(192,57,43,0.15)",
              color: "#c0392b",
              borderRadius: "2px",
              border: "1px solid rgba(192,57,43,0.3)",
            }}
          >
            DEMO MODE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "50%",
                background: "#c0392b",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.5rem",
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {user.initials}
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 500 }}>{user.name}</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)" }}>{user.subtitle}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

function AvatarStack({ count }: { count: number }) {
  const actors = SECONDARY_ACTORS.slice(0, count);
  if (!actors.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <p
        style={{
          fontSize: "0.65rem",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          fontWeight: 600,
          color: "var(--color-muted)",
        }}
      >
        Also in this content
      </p>
      <div style={{ display: "flex", marginLeft: "-0.125rem" }}>
        {actors.map((a) => (
          <div
            key={a.name}
            title={`${a.name} (${a.confidence}%)`}
            style={{
              width: "1.75rem",
              height: "1.75rem",
              borderRadius: "50%",
              overflow: "hidden",
              border: "2px solid var(--color-bg)",
              boxShadow: "0 0 0 1.5px var(--color-border)",
              marginLeft: "-0.5rem",
              background: "#f3f3f3",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ))}
      </div>
      <span style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>
        {actors.length} actor{actors.length === 1 ? "" : "s"} identified
      </span>
    </div>
  );
}

function HitCard({ hit }: { hit: FakeHit }) {
  const riskColor = hit.riskLevel === "high" ? "#dc2626" : "#d97706";
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        borderRadius: "0.5rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <div
          style={{
            width: "2.25rem",
            height: "2.25rem",
            borderRadius: "0.375rem",
            background: "var(--color-surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "0.7rem",
            fontWeight: 700,
            color: "var(--color-muted)",
          }}
        >
          {hit.platform === "instagram" ? "IG" : hit.platform === "tiktok" ? "TT" : "YT"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{hit.handle}</span>
            <span
              style={{
                fontSize: "0.65rem",
                padding: "0.1rem 0.4rem",
                borderRadius: "0.25rem",
                background: `${riskColor}22`,
                color: riskColor,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {hit.riskLevel}
            </span>
            <span
              style={{
                fontSize: "0.65rem",
                padding: "0.1rem 0.4rem",
                borderRadius: "0.25rem",
                background: "rgba(239,68,68,0.15)",
                color: "#dc2626",
                fontWeight: 600,
              }}
            >
              New
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--color-muted)", marginLeft: "auto" }}>
              {hit.detectedRel}
            </span>
          </div>
          <p
            style={{
              marginTop: "0.35rem",
              fontSize: "0.85rem",
              color: "var(--color-ink)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            &ldquo;{hit.caption}&rdquo;
          </p>
        </div>
      </div>

      {/* Reach + confidence bars */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-muted)" }}>
              Account reach
            </p>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-ink)" }}>
              {formatCompact(hit.cumulativeViews)}
            </p>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: "8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-muted)" }}>
              Identity match
            </p>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: hit.confidence >= 85 ? "#dc2626" : "#d97706" }}>
              {hit.confidence}%
            </p>
          </div>
          <div style={{ marginTop: "0.25rem", height: "3px", borderRadius: "999px", background: "var(--color-border)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${hit.confidence}%`,
                background: hit.confidence >= 85 ? "#dc2626" : "#d97706",
                borderRadius: "999px",
              }}
            />
          </div>
        </div>
      </div>

      {hit.secondaries > 0 && <AvatarStack count={hit.secondaries} />}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.4rem 0.75rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
            cursor: "default",
          }}
        >
          Preview
        </button>
        <button
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.4rem 0.75rem",
            borderRadius: "0.25rem",
            border: "none",
            background: "#c0392b",
            color: "#fff",
            cursor: "default",
          }}
        >
          Request takedown
        </button>
        <button
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.4rem 0.75rem",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-muted)",
            cursor: "default",
          }}
        >
          Dismiss ▾
        </button>
      </div>
    </div>
  );
}

function HitsListView() {
  return (
    <div style={{ padding: "1.5rem 2rem", overflowY: "auto", height: "100%", maxWidth: "48rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)" }}>
          Likeness Monitor
        </h1>
        <p style={{ marginTop: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>
          AI-adjudicated scanning of public platforms for unauthorised use of{" "}
          <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{TALENT.fullName}</span>.
        </p>
      </div>

      <div
        style={{
          padding: "0.75rem 1rem",
          borderRadius: "0.5rem",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
          marginBottom: "1rem",
          fontSize: "0.85rem",
          color: "var(--color-ink)",
          fontWeight: 500,
        }}
      >
        {HITS.length} hits awaiting review · sorted by account reach
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {HITS.map((hit) => (
          <HitCard key={hit.handle} hit={hit} />
        ))}
      </div>
    </div>
  );
}

// ─── View: Preview modal ─────────────────────────────────────────────────────

function HitPreviewView() {
  return (
    <div style={{ position: "relative", height: "100%", background: "var(--color-bg)" }}>
      {/* Backdrop: dimmed hits list underneath */}
      <div style={{ opacity: 0.3, filter: "blur(1px)", pointerEvents: "none", height: "100%", overflow: "hidden" }}>
        <HitsListView />
      </div>

      {/* Modal centred */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            width: "min(400px, 100%)",
            maxHeight: "90%",
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div>
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>
                TikTok · @hardy.generates
              </p>
            </div>
            <div style={{ color: "var(--color-muted)", fontSize: "0.9rem" }}>×</div>
          </div>

          {/* Fake TikTok embed frame */}
          <div style={{ aspectRatio: "9 / 16", width: "100%", background: "linear-gradient(135deg, #000 0%, #1a1a1a 100%)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.7)" }}>
              <div
                style={{
                  width: "4rem",
                  height: "4rem",
                  margin: "0 auto 1rem",
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
              </div>
              <p style={{ fontSize: "0.75rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Embedded TikTok player
              </p>
              <p style={{ marginTop: "0.5rem", fontSize: "0.65rem", opacity: 0.6 }}>
                tiktok.com/embed/v2/…
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── View: Accounts queue ────────────────────────────────────────────────────

function AccountsQueueView({ withWhitelistOpen = false }: { withWhitelistOpen?: boolean }) {
  return (
    <div style={{ padding: "1.5rem 2rem", overflowY: "auto", height: "100%", maxWidth: "48rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-accent)", marginBottom: "0.25rem" }}>
          ← Likeness Monitor
        </p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)" }}>
          Accounts
        </h1>
        <p style={{ marginTop: "0.25rem", fontSize: "0.875rem", color: "var(--color-muted)" }}>
          Accounts publishing synthetic content of {TALENT.fullName}, ranked by reach.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
        {[
          { label: "Active", value: OFFENDER_ACCOUNTS.length.toString() },
          { label: "Combined reach", value: formatCompact(OFFENDER_ACCOUNTS.reduce((s, a) => s + a.cumulativeViews, 0)) },
          { label: "Reported", value: "0" },
        ].map((s) => (
          <div key={s.label} style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "0.5rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--color-muted)" }}>{s.label}</div>
            <div style={{ marginTop: "0.35rem", fontSize: "1.5rem", fontWeight: 600, color: "var(--color-ink)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.75rem" }}>
        Priority queue
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {OFFENDER_ACCOUNTS.map((acc, i) => (
          <div
            key={acc.handle}
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              borderRadius: "0.5rem",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-ink)" }}>
                    @{acc.handle}
                  </h3>
                  <span style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>
                    {acc.platform === "instagram" ? "Instagram" : "TikTok"}
                  </span>
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.1rem 0.4rem",
                      borderRadius: "0.25rem",
                      background: "rgba(217,119,6,0.12)",
                      color: "#d97706",
                      fontWeight: 600,
                    }}
                  >
                    On watchlist
                  </span>
                </div>
                <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--color-muted)" }}>
                  {acc.displayName}
                </p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: "1.5rem", lineHeight: 1, fontWeight: 600, color: "var(--color-accent)" }}>
                  {acc.priorityScore}
                </div>
                <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--color-muted)", marginTop: "0.25rem" }}>
                  Priority
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", fontSize: "0.75rem" }}>
              <div>
                <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-muted)" }}>Reach</div>
                <div style={{ marginTop: "0.15rem", fontFamily: "monospace", color: "var(--color-ink)" }}>{formatCompact(acc.cumulativeViews)}</div>
              </div>
              <div>
                <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-muted)" }}>Posts</div>
                <div style={{ marginTop: "0.15rem", fontFamily: "monospace", color: "var(--color-ink)" }}>{acc.hitCount} open</div>
              </div>
              <div>
                <div style={{ fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-muted)" }}>Last seen</div>
                <div style={{ marginTop: "0.15rem", fontFamily: "monospace", color: "var(--color-ink)" }}>{acc.lastSeen}</div>
              </div>
            </div>

            <p style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>{acc.reason}</p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", position: "relative" }}>
              <button
                style={{
                  fontSize: "0.7rem",
                  padding: "0.4rem 0.75rem",
                  borderRadius: "0.25rem",
                  background: "var(--color-ink)",
                  color: "#fff",
                  border: "none",
                  cursor: "default",
                }}
              >
                Mark reported
              </button>
              <div style={{ display: "flex", gap: "0.5rem", position: "relative" }}>
                <button
                  style={{
                    fontSize: "0.7rem",
                    padding: "0.4rem 0.75rem",
                    borderRadius: "0.25rem",
                    background: "var(--color-surface)",
                    color: "var(--color-ink)",
                    border: "1px solid var(--color-border)",
                    cursor: "default",
                  }}
                >
                  Contact
                </button>
                <button
                  style={{
                    fontSize: "0.7rem",
                    padding: "0.4rem 0.75rem",
                    borderRadius: "0.25rem",
                    background: withWhitelistOpen && i === 0 ? "var(--color-ink)" : "var(--color-surface)",
                    color: withWhitelistOpen && i === 0 ? "#fff" : "var(--color-muted)",
                    border: "1px solid var(--color-border)",
                    cursor: "default",
                  }}
                >
                  Whitelist ▾
                </button>
                {/* Whitelist dropdown on first row */}
                {withWhitelistOpen && i === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 0.3rem)",
                      right: 0,
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.375rem",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                      width: "16rem",
                      zIndex: 10,
                    }}
                  >
                    {[
                      "False positive — not misuse",
                      "Harmless fan content",
                      "Talent has approved this account",
                      "Other…",
                    ].map((label) => (
                      <div
                        key={label}
                        style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "var(--color-ink)", cursor: "default" }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── View: Contact modal ─────────────────────────────────────────────────────

function ContactComposeView() {
  const body = `Hi @${TAKEDOWN_TARGET.handle},

I'm reaching out on behalf of ${TALENT.fullName}. We've noticed you've been creating AI-generated content featuring ${TALENT.fullName}, and we wanted to open a conversation rather than send takedowns.

${TALENT.fullName} is exploring a licensed programme where creators can produce AI content of them within an agreed framework — including revenue sharing on monetised posts. If that's something you'd be interested in, reply here and I'll send more details on how it works.

Thanks for reading.`;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div style={{ opacity: 0.3, filter: "blur(1px)", pointerEvents: "none", height: "100%", overflow: "hidden" }}>
        <AccountsQueueView />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            width: "min(560px, 100%)",
            maxHeight: "90%",
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--color-ink)" }}>
              Contact @{TAKEDOWN_TARGET.handle}
            </h3>
            <p style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>
              Instagram · {TAKEDOWN_TARGET.displayName}
            </p>
          </div>

          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", overflow: "auto" }}>
            <div>
              <p style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                Message purpose
              </p>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                {[
                  { label: "Licence offer", active: true },
                  { label: "Consent request", active: false },
                  { label: "Takedown request", active: false },
                ].map((p) => (
                  <div
                    key={p.label}
                    style={{
                      fontSize: "0.7rem",
                      padding: "0.3rem 0.6rem",
                      borderRadius: "0.25rem",
                      background: p.active ? "var(--color-ink)" : "var(--color-surface)",
                      color: p.active ? "#fff" : "var(--color-ink)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {p.label}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-muted)", marginBottom: "0.4rem" }}>
                Message
              </p>
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  borderRadius: "0.25rem",
                  padding: "0.75rem",
                  fontSize: "0.8rem",
                  color: "var(--color-ink)",
                  whiteSpace: "pre-line",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  maxHeight: "12rem",
                  overflow: "auto",
                }}
              >
                {body}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", borderTop: "1px solid var(--color-border)", gap: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}>
                Copy message
              </div>
              <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}>
                Open on platform →
              </div>
            </div>
            <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-ink)", color: "#fff" }}>
              Mark sent
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── View: Admin panel (cron + takedowns + provider) ─────────────────────────

function AdminPanelView() {
  return (
    <div style={{ padding: "1.5rem 2rem", overflowY: "auto", height: "100%", maxWidth: "56rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 600, color: "var(--color-accent)", marginBottom: "0.25rem" }}>
          ← Admin
        </p>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 600, color: "var(--color-ink)" }}>
          Likeness Monitor — Operations
        </h1>
      </div>

      {/* Cron controls */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-ink)", marginBottom: "0.25rem" }}>
          Cron controls
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.75rem" }}>
          Sweeps run twice daily via ai-cron-worker, honouring each monitor&apos;s cadence.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "0.375rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--color-muted)" }}>Cron status</div>
            <div style={{ marginTop: "0.35rem", fontSize: "1.35rem", fontWeight: 600, color: "var(--color-accent)" }}>On</div>
          </div>
          <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "0.375rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--color-muted)" }}>Last cron run</div>
            <div style={{ marginTop: "0.35rem", fontSize: "1.35rem", fontWeight: 600, color: "var(--color-ink)" }}>2h ago</div>
          </div>
          <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "0.375rem", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--color-muted)" }}>Watchlist re-harvest</div>
            <div style={{ marginTop: "0.35rem", fontSize: "1.35rem", fontWeight: 600, color: "var(--color-ink)" }}>168h</div>
          </div>
        </div>

        <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "0.5rem", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--color-ink)" }}>Cron enabled</p>
              <p style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>Pause the fleet without redeploying.</p>
            </div>
            <div style={{ fontSize: "0.7rem", padding: "0.35rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}>
              Pause cron
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--color-border)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--color-ink)" }}>Identity-check provider</p>
              <p style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>LLaVA (free, ~90% cap) or Rekognition (real cosine, 95%+, ~$0.002/hit).</p>
            </div>
            <div style={{ display: "flex", gap: "0.2rem" }}>
              {[
                { label: "LLaVA", active: true },
                { label: "Rekognition", active: false },
                { label: "Both", active: false },
              ].map((p) => (
                <div
                  key={p.label}
                  style={{
                    fontSize: "0.7rem",
                    padding: "0.3rem 0.6rem",
                    borderRadius: "0.25rem",
                    background: p.active ? "var(--color-ink)" : "var(--color-surface)",
                    color: p.active ? "#fff" : "var(--color-ink)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--color-border)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <p style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--color-ink)" }}>Run cron now</p>
              <p style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>Same code path as the scheduled trigger.</p>
            </div>
            <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.9rem", borderRadius: "0.25rem", background: "var(--color-accent)", color: "#fff" }}>
              Run now
            </div>
          </div>
        </div>
      </div>

      {/* Takedown backlog */}
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-ink)", marginBottom: "0.25rem" }}>
          Takedown backlog
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "0.75rem" }}>
          Every hit a talent asked us to file a takedown for.
        </p>
        <div
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            borderRadius: "0.5rem",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.7rem", color: "var(--color-muted)" }}>
                <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{TALENT.fullName}</span>
                {" · Instagram · @"}{TAKEDOWN_TARGET.handle}
              </div>
              <p style={{ marginTop: "0.35rem", fontSize: "0.8rem", color: "var(--color-ink)" }}>
                &ldquo;Anti-Venom (2027) – Tom Hardy, Mads Mikkelsen, John Cena | Concept Trailer…&rdquo;
              </p>
              <div style={{ marginTop: "0.35rem", fontSize: "0.7rem", color: "var(--color-muted)", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <span>Requested 2h ago</span>
                <span>Risk: high</span>
                <span>AI: 90%</span>
              </div>
            </div>
            <div style={{ fontSize: "0.6rem", padding: "0.15rem 0.5rem", borderRadius: "0.25rem", background: "var(--color-accent)", color: "#fff", fontWeight: 600 }}>
              Open
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "2px" }}>
              View content →
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-ink)", color: "#fff" }}>
                Send report to Meta
              </div>
              <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-accent)", color: "#fff" }}>
                Mark resolved
              </div>
              <div style={{ fontSize: "0.7rem", padding: "0.4rem 0.75rem", borderRadius: "0.25rem", background: "var(--color-surface)", color: "var(--color-ink)", border: "1px solid var(--color-border)" }}>
                Dismiss
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Scenes ───────────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: "hits-list",
    view: "hits-list",
    role: "talent",
    activeNav: "monitor",
    headline: "Every AI hit, reach-weighted",
    body: "The Anti-Venom concept trailer sits at the top — 4.8M cumulative views on the account. Mads Mikkelsen, John Cena and Channing Tatum are stacked on the card because they were identified in the same media.",
  },
  {
    id: "hit-preview",
    view: "hit-preview",
    role: "talent",
    activeNav: "monitor",
    headline: "Preview the content in-app",
    body: "Click Preview and the platform's embed renders inline. Triage without flipping to a new tab and back. Works for TikTok, Instagram and YouTube; X falls back to the platform link.",
  },
  {
    id: "accounts-queue",
    view: "accounts-queue",
    role: "talent",
    activeNav: "monitor-accounts",
    headline: "Priority queue by offender account",
    body: "Ultimate Studios is the target worth acting on first — one account producing multiple fake trailers. Whitelist to clear it if it's a legit partner; Contact to open a licence conversation instead of a takedown.",
  },
  {
    id: "contact-compose",
    view: "contact-compose",
    role: "talent",
    activeNav: "monitor-accounts",
    headline: "Turn offenders into licensees",
    body: "Pre-filled Licence offer template. Copy the message, open the platform's DM composer, send it, mark it sent. Every outreach logged so we don't spam the same account twice.",
  },
  {
    id: "admin-panel",
    view: "admin-panel",
    role: "admin",
    activeNav: "admin-monitor",
    headline: "Continuous sweeps, no operator effort",
    body: "Cron fires twice daily and hits every talent whose cadence is due. Provider is LLaVA by default (free, ~90% cap) — flip to AWS Rekognition when you need real face embeddings. Takedown backlog files to Meta with one click.",
  },
];

// ─── TourCard ────────────────────────────────────────────────────────────────

// Style parity with /demo/production: floating blurred-glass card with
// centred dot indicators and prev/next arrows, and safe-area-aware bottom
// spacing so it doesn't collide with mobile home-indicators.
function TourCard({
  scene,
  sceneIndex,
  total,
  paused,
  onPrev,
  onNext,
  onMouseEnter,
  onMouseLeave,
}: {
  scene: Scene;
  sceneIndex: number;
  total: number;
  paused: boolean;
  onPrev: () => void;
  onNext: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const mobile = useIsMobile();

  return (
    <div
      // Hover-pause is desktop-only: on touch devices taps fire a synthetic
      // mouseenter with no mouseleave to follow, which would stick the tour
      // paused. Mobile pauses via press-and-hold on the shell instead.
      onMouseEnter={mobile ? undefined : onMouseEnter}
      onMouseLeave={mobile ? undefined : onMouseLeave}
      style={{
        position: "absolute",
        bottom: mobile ? "calc(0.625rem + env(safe-area-inset-bottom))" : "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        width: mobile ? "calc(100% - 1.25rem)" : "min(600px, calc(100% - 3rem))",
        background: "rgba(10,10,10,0.93)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: "8px",
        padding: mobile ? "0.875rem 1rem" : "1.25rem 1.5rem",
        color: "#fff",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07)",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.875rem", justifyContent: "center" }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              width: i === sceneIndex ? "1.5rem" : "0.375rem",
              height: "0.375rem",
              borderRadius: "9999px",
              background: i === sceneIndex ? "#c0392b" : "rgba(255,255,255,0.2)",
              transition: "width 0.3s ease, background 0.3s ease",
            }}
          />
        ))}
      </div>

      <h3 style={{ fontSize: mobile ? "0.875rem" : "0.9375rem", fontWeight: 600, margin: "0 0 0.375rem", letterSpacing: "-0.01em", color: "#fff" }}>
        {scene.headline}
      </h3>
      <p style={{ fontSize: mobile ? "0.75rem" : "0.8125rem", color: "rgba(255,255,255,0.6)", margin: mobile ? "0 0 0.75rem" : "0 0 1rem", lineHeight: mobile ? 1.55 : 1.65 }}>
        {scene.body}
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={onPrev}
          style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", background: "transparent", color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prev
        </button>
        <span style={{ fontSize: mobile ? "0.625rem" : "0.6875rem", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {paused ? "Paused" : mobile ? "Swipe" : "Auto-playing"} · {sceneIndex + 1} / {total}
        </span>
        <button
          onClick={onNext}
          style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "none", borderRadius: "4px", background: "#c0392b", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}
        >
          Next
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Mobile top bar ──────────────────────────────────────────────────────────
// Replaces the 14rem sidebar on phones so the scene isn't crushed to a strip.
function MobileTopBar({ role }: { role: "talent" | "admin" }) {
  const user =
    role === "talent"
      ? { name: TALENT.fullName, subtitle: "Talent", initials: TALENT.initials }
      : { name: "Admin", subtitle: "Platform Admin", initials: "AD" };
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "0.625rem 1rem",
        paddingTop: "calc(0.625rem + env(safe-area-inset-top))",
        background: "#0a0a0a",
        color: "#fff",
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 500, letterSpacing: "0.05em" }}>ImageVault</div>
        <div style={{ marginTop: "0.25rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
      </div>
      <div
        style={{
          fontSize: "0.5625rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          padding: "0.2rem 0.5rem",
          background: "rgba(192,57,43,0.15)",
          color: "#c0392b",
          borderRadius: "2px",
          border: "1px solid rgba(192,57,43,0.3)",
          flexShrink: 0,
        }}
      >
        DEMO
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <div style={{ minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
          <div style={{ fontSize: "0.5625rem", color: "rgba(255,255,255,0.45)" }}>{user.subtitle}</div>
        </div>
        <div style={{ width: "1.625rem", height: "1.625rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", fontWeight: 700, flexShrink: 0 }}>
          {user.initials}
        </div>
      </div>
    </div>
  );
}

// ─── Intro overlay ───────────────────────────────────────────────────────────

type IntroState = "visible" | "leaving" | "gone";

function IntroOverlay({ leaving, onDismiss }: { leaving: boolean; onDismiss: () => void }) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(10,10,10,0.94)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: leaving ? 0 : 1,
        transition: "opacity 700ms ease-out",
      }}
    >
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ fontSize: "0.7rem", letterSpacing: "0.2em", textTransform: "uppercase", color: "#c0392b", fontWeight: 700, marginBottom: "1rem" }}>
          Product Tour
        </p>
        <h1 style={{ fontSize: "2rem", fontWeight: 600, lineHeight: 1.2, maxWidth: "36rem", margin: "0 auto" }}>
          Likeness Monitor
        </h1>
        <p style={{ marginTop: "1rem", fontSize: "0.95rem", color: "rgba(255,255,255,0.7)", maxWidth: "32rem", margin: "1rem auto 0" }}>
          Continuous, AI-adjudicated sweeps across TikTok, Instagram and YouTube — with in-app preview, per-talent whitelisting, one-click Meta takedowns, and a licensing bridge for offenders.
        </p>
      </div>
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function DemoMonitorClient() {
  // Starts null so the server render (which has no window) matches the
  // first client render; resolves in the effect below.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [intro, setIntro] = useState<IntroState>("visible");
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (intro === "gone") return;
    const t = setTimeout(
      () => setIntro(intro === "visible" ? "leaving" : "gone"),
      intro === "visible" ? INTRO_HOLD_MS : INTRO_FADE_MS
    );
    return () => clearTimeout(t);
  }, [intro]);

  useEffect(() => {
    if (isMobile === null || paused || intro !== "gone") return;
    const t = setTimeout(() => setSceneIndex((i) => (i + 1) % SCENES.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [sceneIndex, paused, intro, isMobile]);

  if (isMobile === null) return null;

  const scene = SCENES[sceneIndex];

  const goPrev = () => setSceneIndex((i) => (i - 1 + SCENES.length) % SCENES.length);
  const goNext = () => setSceneIndex((i) => (i + 1) % SCENES.length);

  return (
    <IsMobileContext.Provider value={isMobile}>
      <div
        style={{
          display: "flex",
          // Phones stack vertically: MobileTopBar on top, scene below,
          // TourCard floats at the bottom. Desktop keeps sidebar-on-left.
          flexDirection: isMobile ? "column" : "row",
          height: "100vh",
          overflow: "hidden",
        }}
        onTouchStart={(e) => {
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          setPaused(true);
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          touchStart.current = null;
          setPaused(false);
          if (!start) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) goNext();
            else goPrev();
          }
        }}
        onTouchCancel={() => {
          touchStart.current = null;
          setPaused(false);
        }}
      >
        {intro !== "gone" && <IntroOverlay leaving={intro === "leaving"} onDismiss={() => setIntro("leaving")} />}
        {isMobile ? <MobileTopBar role={scene.role} /> : <Sidebar role={scene.role} />}
        <main style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "var(--color-bg)", position: "relative", display: "flex", flexDirection: "column" }}>
          <div key={`${scene.id}-${intro === "gone"}`} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {scene.view === "hits-list" && <HitsListView />}
            {scene.view === "hit-preview" && <HitPreviewView />}
            {scene.view === "accounts-queue" && <AccountsQueueView withWhitelistOpen={false} />}
            {scene.view === "contact-compose" && <ContactComposeView />}
            {scene.view === "admin-panel" && <AdminPanelView />}
          </div>
          <TourCard
            scene={scene}
            sceneIndex={sceneIndex}
            total={SCENES.length}
            paused={paused}
            onPrev={goPrev}
            onNext={goNext}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          />
        </main>
      </div>
    </IsMobileContext.Provider>
  );
}
