"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType =
  | "production-list"
  | "cast-search"
  | "cast-list"
  | "licence-compliance"
  | "consent-dashboard"
  | "usage-events"
  | "strike-lock"
  | "compliance-ledger"
  | "certificate";

type DemoMode = "production" | "compliance";
type SidebarRole = "production" | "compliance";
type NavId = "productions" | "cast" | "licences" | "dashboard" | "ledger" | "certificates" | "settings";

interface Scene {
  id: string;
  view: ViewType;
  sidebarRole: SidebarRole;
  headline: string;
  body: string;
}

const AUTO_MS = 6000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Fake data ────────────────────────────────────────────────────────────────

const PRODUCTION = {
  name: "Blade Runner 3",
  company: "Warner Bros. Pictures",
  type: "Film",
  year: 2026,
  status: "Pre-Production",
  sagProjectNumber: "SAG-2026-0047",
  vfxSupervisor: "John Davis",
  director: "Denis Villeneuve",
};

const CAST_SEARCH_RESULTS = [
  {
    id: "talent-emma",
    name: "Emma Richardson",
    initials: "ER",
    packages: 3,
    primaryScan: "Light Stage — Framestore London",
    sagMember: true,
  },
  {
    id: "talent-james",
    name: "James Harlow",
    initials: "JH",
    packages: 1,
    primaryScan: "Photogrammetry — Weta Digital",
    sagMember: true,
  },
];

const CAST_MEMBER = {
  name: "Emma Richardson",
  initials: "ER",
  character: "Rachael",
  sagMember: true,
  scanPackage: "Full Body — Framestore London",
  scanType: "Light Stage",
};

const COMPLIANCE_EVENTS = [
  {
    seq: 1,
    eventType: "consent_granted",
    label: "Consent Granted",
    clauseRef: "39.B",
    regime: "SAG-AFTRA",
    actor: "Emma Richardson",
    scope: "Standard use",
    timeLabel: "3 days ago",
    ts: 1748390400,
    hash: "a3f8c2d1e9b4",
    prevHash: "genesis",
    colour: "#166534",
  },
  {
    seq: 2,
    eventType: "usage_commenced",
    label: "Usage Commenced",
    clauseRef: "39.D",
    regime: "SAG-AFTRA",
    actor: "VFX Dept — Warner Bros.",
    scope: "Pre-compositing",
    timeLabel: "2 days ago",
    ts: 1748476800,
    hash: "b7e1a4f9c2d8",
    prevHash: "a3f8c2d1e9b4",
    colour: "#1d4ed8",
  },
  {
    seq: 3,
    eventType: "file_access",
    label: "File Access",
    clauseRef: "39.E",
    regime: "SAG-AFTRA",
    actor: "Render Farm Node 14",
    scope: "Biometric isolation confirmed",
    timeLabel: "6 hours ago",
    ts: 1748520000,
    hash: "c9d3b6e2f1a7",
    prevHash: "b7e1a4f9c2d8",
    colour: "#1d4ed8",
  },
  {
    seq: 4,
    eventType: "strike_lock",
    label: "Strike Lock",
    clauseRef: "39.G",
    regime: "SAG-AFTRA",
    actor: "System — Union trigger",
    scope: "Global freeze",
    timeLabel: "just now",
    ts: 1748563200,
    hash: "d2f5a8c4b1e9",
    prevHash: "c9d3b6e2f1a7",
    colour: "#991b1b",
  },
];

// ─── Tour scenes ──────────────────────────────────────────────────────────────

const PRODUCTION_SCENES: Scene[] = [
  {
    id: "production-list",
    view: "production-list",
    sidebarRole: "production",
    headline: "Onboard a production",
    body: "Warner Bros. creates Blade Runner 3 — SAG project number assigned, VFX supervisor named, compliance regime selected. All obligations are tracked from day one.",
  },
  {
    id: "cast-search",
    view: "cast-search",
    sidebarRole: "production",
    headline: "Find your cast",
    body: "Search the talent directory. Emma Richardson is matched with 3 scan packages ready. An invite is sent — she's linked to the production once she accepts.",
  },
  {
    id: "cast-list",
    view: "cast-list",
    sidebarRole: "production",
    headline: "Cast confirmed, scan ready",
    body: "Emma has accepted and linked her full-body light stage scan to Blade Runner 3. Files remain locked until a licence is approved and both parties complete 2FA.",
  },
  {
    id: "licence-compliance",
    view: "licence-compliance",
    sidebarRole: "production",
    headline: "Compliance-backed licence",
    body: "The production requests access to Emma's scan. SAG-AFTRA Article 39 compliance is on — every consent event, download, and usage milestone will be ledgered.",
  },
];

const COMPLIANCE_SCENES: Scene[] = [
  {
    id: "consent-dashboard",
    view: "consent-dashboard",
    sidebarRole: "compliance",
    headline: "Consent recorded",
    body: "Emma grants standard use consent under SAG-AFTRA 39.B. The first event is appended to the hash-chained ledger — immutable and auditable from this point forward.",
  },
  {
    id: "usage-events",
    view: "usage-events",
    sidebarRole: "compliance",
    headline: "Usage events stream in",
    body: "VFX work commences. Each milestone — shoot start, file access, render farm — fires a compliance event, timestamped and cryptographically linked to the previous.",
  },
  {
    id: "strike-lock",
    view: "strike-lock",
    sidebarRole: "compliance",
    headline: "Strike lock applied",
    body: "SAG-AFTRA declares a strike. A global lock fires automatically — all file access is frozen across every active production. No manual intervention required.",
  },
  {
    id: "compliance-ledger",
    view: "compliance-ledger",
    sidebarRole: "compliance",
    headline: "Tamper-proof ledger",
    body: "4 events, each cryptographically linked to the last. Auditors and unions can verify the full chain of custody without ever accessing the underlying files.",
  },
  {
    id: "certificate",
    view: "certificate",
    sidebarRole: "compliance",
    headline: "Compliance certificate issued",
    body: "A timestamped certificate — regime, event count, and ledger tip hash. Legal-grade documentation ready for SAG-AFTRA, GDPR, and BIPA obligations.",
  },
];

// ─── Nav definitions ──────────────────────────────────────────────────────────

const PRODUCTION_NAV = [
  {
    id: "productions" as NavId,
    label: "Productions",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" />
        <polyline points="16 2 12 7 8 2" />
      </svg>
    ),
  },
  {
    id: "cast" as NavId,
    label: "Cast",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "licences" as NavId,
    label: "Licences",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "settings" as NavId,
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const COMPLIANCE_NAV = [
  {
    id: "dashboard" as NavId,
    label: "Dashboard",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: "ledger" as NavId,
    label: "Ledger",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="16" y2="17" />
        <line x1="8" y1="9" x2="10" y2="9" />
      </svg>
    ),
  },
  {
    id: "certificates" as NavId,
    label: "Certificates",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="6" />
        <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
      </svg>
    ),
  },
  {
    id: "settings" as NavId,
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function DemoSidebar({ role, activeId }: { role: SidebarRole; activeId: NavId }) {
  const nav = role === "production" ? PRODUCTION_NAV : COMPLIANCE_NAV;
  const user =
    role === "production"
      ? { initials: "WB", name: "Warner Bros.", subtitle: "Production Co." }
      : { initials: "CO", name: "Compliance Officer", subtitle: "Platform Admin" };

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
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "2rem 0" }}>
        <div>
          <a href="/demo/production" style={{ display: "block", padding: "0 1.5rem", marginBottom: "2.5rem", textDecoration: "none" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>Image Vault</div>
            <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
          </a>
          <nav style={{ padding: "0 0.75rem" }}>
            {nav.map((item) => {
              const active = item.id === activeId;
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "0.25rem",
                    marginBottom: "0.125rem",
                    background: active ? "rgba(192,57,43,0.18)" : "transparent",
                    borderLeft: active ? "3px solid #c0392b" : "3px solid transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.45)",
                    fontSize: "0.875rem",
                    cursor: "default",
                    userSelect: "none",
                  }}
                >
                  {item.icon}
                  {item.label}
                </div>
              );
            })}
          </nav>
        </div>

        <div style={{ padding: "0 1.5rem" }}>
          <div style={{ marginBottom: "1rem", display: "inline-block", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", padding: "0.2rem 0.5rem", background: "rgba(192,57,43,0.15)", color: "#c0392b", borderRadius: "2px", border: "1px solid rgba(192,57,43,0.3)" }}>
            DEMO MODE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", fontWeight: 700, color: "#fff", flexShrink: 0, letterSpacing: "0.05em" }}>
              {user.initials}
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#fff" }}>{user.name}</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}>{user.subtitle}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Production List View ─────────────────────────────────────────────────────

function ProductionListView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Productions</h1>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>1 active production</p>
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-ink)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Production
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-ink)" }}>{PRODUCTION.name}</span>
                <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.5rem", borderRadius: "9999px", background: "#fef9c3", color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {PRODUCTION.status}
                </span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 0.875rem" }}>
                {PRODUCTION.company} · {PRODUCTION.type} · {PRODUCTION.year}
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "0.875rem" }}>
                {[
                  { label: "Director", value: PRODUCTION.director },
                  { label: "VFX Supervisor", value: PRODUCTION.vfxSupervisor },
                  { label: "SAG Project #", value: PRODUCTION.sagProjectNumber },
                ].map((row) => (
                  <div key={row.label}>
                    <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.2rem" }}>{row.label}</p>
                    <p style={{ fontSize: "0.8125rem", color: "var(--color-ink)", margin: 0 }}>{row.value}</p>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "1.5rem" }}>
                {[
                  { label: "Cast members", value: "1" },
                  { label: "Active licences", value: "0" },
                  { label: "Compliance", value: "SAG-AFTRA" },
                ].map((s) => (
                  <div key={s.label}>
                    <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.125rem" }}>{s.label}</p>
                    <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: 0 }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
              <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>Edit</button>
              <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, border: "none", borderRadius: "var(--radius)", background: "var(--color-ink)", color: "#fff", cursor: "default" }}>Manage</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cast Search View ─────────────────────────────────────────────────────────

function CastSearchView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
          Productions / Blade Runner 3
        </div>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Add Cast</h1>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ position: "relative", marginBottom: "1.25rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)" }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div style={{ padding: "0.6rem 0.75rem 0.6rem 2.25rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            Emma Richardson
          </div>
        </div>

        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          {CAST_SEARCH_RESULTS.length} results
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1.25rem" }}>
          {CAST_SEARCH_RESULTS.map((talent, i) => (
            <div
              key={talent.id}
              style={{
                border: `1px solid ${i === 0 ? "rgba(192,57,43,0.3)" : "var(--color-border)"}`,
                borderRadius: "var(--radius)",
                background: i === 0 ? "rgba(192,57,43,0.03)" : "var(--color-surface)",
                padding: "1rem 1.25rem",
                display: "flex",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "50%", background: i === 0 ? "#c0392b" : "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.625rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {talent.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{talent.name}</span>
                  {talent.sagMember && (
                    <span style={{ fontSize: "0.55rem", fontWeight: 700, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#dbeafe", color: "#1d4ed8", letterSpacing: "0.06em" }}>
                      SAG-AFTRA
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>
                  {talent.packages} scan package{talent.packages !== 1 ? "s" : ""} · {talent.primaryScan}
                </p>
              </div>
              <button style={{ padding: "0.375rem 0.875rem", fontSize: "0.75rem", fontWeight: 500, border: "none", borderRadius: "var(--radius)", background: i === 0 ? "var(--color-accent)" : "var(--color-border)", color: i === 0 ? "#fff" : "var(--color-muted)", cursor: "default", flexShrink: 0 }}>
                {i === 0 ? "Invite to cast" : "Add"}
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.75rem 1rem", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", background: "#f0fdf4" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p style={{ fontSize: "0.8125rem", color: "#166534", margin: 0 }}>
            Invite sent to <strong>Emma Richardson</strong> — awaiting acceptance.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Cast List View ───────────────────────────────────────────────────────────

function CastListView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
          Productions / Blade Runner 3
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Cast</h1>
          <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.875rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-ink)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add cast
          </button>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: "1rem", padding: "0.5rem 1rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            {["Talent", "Character", "Status", "Scan Package", ""].map((h) => (
              <p key={h} style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>{h}</p>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: "1rem", alignItems: "center", padding: "0.875rem 1rem", background: "var(--color-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ width: "2rem", height: "2rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                {CAST_MEMBER.initials}
              </div>
              <div>
                <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.1rem" }}>{CAST_MEMBER.name}</p>
                <span style={{ fontSize: "0.55rem", fontWeight: 700, padding: "0.1rem 0.35rem", borderRadius: "2px", background: "#dbeafe", color: "#1d4ed8" }}>SAG-AFTRA</span>
              </div>
            </div>

            <p style={{ fontSize: "0.875rem", color: "var(--color-ink)", margin: 0 }}>{CAST_MEMBER.character}</p>

            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.2rem 0.6rem", borderRadius: "9999px", background: "#dcfce7", color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em", display: "inline-block" }}>
              Scan Ready
            </span>

            <div>
              <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.1rem" }}>{CAST_MEMBER.scanPackage}</p>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>{CAST_MEMBER.scanType}</p>
            </div>

            <button style={{ padding: "0.3rem 0.625rem", fontSize: "0.6875rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default", whiteSpace: "nowrap" }}>
              Request licence
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.75rem 1rem", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", background: "#f0fdf4" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p style={{ fontSize: "0.8125rem", color: "#166534", margin: 0 }}>
            Emma{"'"}s scan is linked to Blade Runner 3 — held pending licence approval.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Licence Compliance View ──────────────────────────────────────────────────

function LicenceComplianceView() {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.25rem" }}>
        Productions / Blade Runner 3 / Cast / Emma Richardson
      </div>
      <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 1.5rem" }}>
        Request Licence
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "40rem" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "1rem", background: "var(--color-surface)" }}>
          <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>Scan package</p>
          <p style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.125rem" }}>Full Body — Framestore London</p>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>Light Stage · Mesh · Textures · HDR · 847 files</p>
        </div>

        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {[
            { label: "Usage type", value: "Film / Digital Double" },
            { label: "Territory", value: "Worldwide" },
            { label: "Exclusivity", value: "Non-exclusive" },
            { label: "Licence period", value: "1 Jan 2026 – 31 Dec 2027" },
            { label: "Proposed fee", value: "$85,000" },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.625rem 1rem", borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
              <span style={{ fontSize: "0.8125rem", color: "var(--color-muted)" }}>{row.label}</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--color-ink)" }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* SAG-AFTRA compliance toggle — ON */}
        <div style={{ border: "1px solid rgba(192,57,43,0.3)", borderRadius: "var(--radius)", padding: "1rem", background: "rgba(192,57,43,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c0392b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)" }}>SAG-AFTRA Compliance</span>
            </div>
            <div style={{ width: "2.5rem", height: "1.25rem", borderRadius: "9999px", background: "#c0392b", position: "relative", cursor: "default", flexShrink: 0 }}>
              <div style={{ position: "absolute", right: "0.125rem", top: "0.125rem", width: "1rem", height: "1rem", borderRadius: "50%", background: "#fff" }} />
            </div>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 0.625rem", lineHeight: 1.6 }}>
            Article 39 compliance mode enabled. All consent, usage, and download events will be appended to the hash-chained ledger.
          </p>
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {["39.B Consent", "39.D Usage", "39.E Biometric", "39.G Strike", "39.I Transfers"].map((tag) => (
              <span key={tag} style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.15rem 0.5rem", borderRadius: "2px", background: "rgba(192,57,43,0.1)", color: "#c0392b", border: "1px solid rgba(192,57,43,0.2)" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        <button style={{ padding: "0.75rem", fontSize: "0.875rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
          Submit licence request
        </button>
      </div>
    </div>
  );
}

// ─── Consent Dashboard View ───────────────────────────────────────────────────

function ConsentDashboardView() {
  const event = COMPLIANCE_EVENTS[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.25rem" }}>Compliance</p>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Consent Records</h1>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {[
            { label: "Active consents", value: "1" },
            { label: "Regime", value: "SAG-AFTRA" },
            { label: "Events logged", value: "1" },
          ].map((c) => (
            <div key={c.label} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.875rem 1rem", background: "var(--color-surface)" }}>
              <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>{c.label}</p>
              <p style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-ink)", margin: 0 }}>{c.value}</p>
            </div>
          ))}
        </div>

        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          Active consent records
        </p>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "1rem", padding: "0.5rem 1rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            {["Talent", "Use type", "Valid until", "Status"].map((h) => (
              <p key={h} style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>{h}</p>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "1rem", alignItems: "center", padding: "0.875rem 1rem", background: "var(--color-bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <div style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>ER</div>
              <div>
                <p style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.1rem" }}>Emma Richardson</p>
                <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>Blade Runner 3</p>
              </div>
            </div>
            <div>
              <p style={{ fontSize: "0.8125rem", color: "var(--color-ink)", margin: "0 0 0.1rem" }}>Standard Use</p>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>Clause 39.B</p>
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-ink)", margin: 0 }}>31 Dec 2027</p>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.2rem 0.6rem", borderRadius: "9999px", background: "#dcfce7", color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Granted
            </span>
          </div>
        </div>

        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          First ledger event
        </p>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "1rem", background: "var(--color-surface)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <div style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-ink)" }}>consent_granted</span>
                <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#dbeafe", color: "#1d4ed8" }}>39.B</span>
                <span style={{ fontSize: "0.625rem", color: "var(--color-muted)" }}>seq #1</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>
                {event.actor} · {event.timeLabel} · SAG-AFTRA
              </p>
              <p style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "var(--color-muted)", margin: 0 }}>
                hash: {event.hash}... · prev: genesis
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Usage Events View ────────────────────────────────────────────────────────

function UsageEventsView() {
  const events = COMPLIANCE_EVENTS.slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.25rem" }}>Compliance</p>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Event Feed</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "#166534" }}>
            <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: "#166534", display: "inline-block" }} />
            Live
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", left: "0.875rem", top: "1.5rem", bottom: "1.5rem", width: "1px", background: "var(--color-border)" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            {events.map((event, i) => {
              const isStrike = event.eventType === "strike_lock";
              const isLatest = i === events.length - 1;
              const dotColour = event.eventType === "consent_granted" ? "#166534" : "#1d4ed8";
              const bgColour = event.eventType === "consent_granted" ? "#dcfce7" : "#dbeafe";

              return (
                <div key={event.seq} style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
                  <div style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", background: bgColour, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1, border: isLatest ? `2px solid ${dotColour}` : "2px solid transparent" }}>
                    <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: dotColour, display: "inline-block" }} />
                  </div>

                  <div style={{ flex: 1, border: `1px solid ${isStrike ? "#fecaca" : isLatest ? dotColour + "44" : "var(--color-border)"}`, borderRadius: "var(--radius)", padding: "0.875rem 1rem", background: isLatest ? bgColour + "55" : "var(--color-surface)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-ink)" }}>{event.label}</span>
                        <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#dbeafe", color: "#1d4ed8" }}>{event.clauseRef}</span>
                        {isLatest && (
                          <span style={{ fontSize: "0.55rem", fontWeight: 700, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#dcfce7", color: "#166534", letterSpacing: "0.06em" }}>NEW</span>
                        )}
                      </div>
                      <span style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>#{event.seq}</span>
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>
                      {event.actor} · {event.timeLabel} · {event.regime}
                    </p>
                    <p style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "var(--color-muted)", margin: 0 }}>
                      {event.hash}...
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Strike Lock View ─────────────────────────────────────────────────────────

function StrikeLockView() {
  const lockEvent = COMPLIANCE_EVENTS[3];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid #fecaca", padding: "1.25rem 3rem", flexShrink: 0, background: "#fef2f2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#991b1b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div>
            <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#991b1b", margin: "0 0 0.1rem" }}>Strike Lock Active</p>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "#991b1b", margin: 0 }}>All file access frozen</h1>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ border: "1px solid #fecaca", borderRadius: "var(--radius)", padding: "1.25rem", background: "#fef2f2", marginBottom: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
            {[
              { label: "Scope", value: "Global" },
              { label: "Clause", value: "39.G" },
              { label: "Declared", value: formatDate(lockEvent.ts) },
            ].map((row) => (
              <div key={row.label}>
                <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#991b1b", opacity: 0.7, margin: "0 0 0.2rem" }}>{row.label}</p>
                <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#7f1d1d", margin: 0 }}>{row.value}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#7f1d1d", margin: 0, lineHeight: 1.6 }}>
            SAG-AFTRA strike declared. All download tokens have been invalidated. File access is blocked across all active licences until the strike is resolved and the lock is formally lifted.
          </p>
        </div>

        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          Affected productions (1)
        </p>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.875rem 1rem", background: "var(--color-bg)" }}>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.125rem" }}>{PRODUCTION.name}</p>
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>{PRODUCTION.company} · 1 licence · 1 talent affected</p>
            </div>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.2rem 0.6rem", borderRadius: "9999px", background: "#fee2e2", color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
              Access Frozen
            </span>
          </div>
        </div>

        <div style={{ border: "1px solid #fecaca", borderRadius: "var(--radius)", padding: "1rem", background: "var(--color-surface)" }}>
          <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.5rem" }}>Ledger event appended</p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-ink)" }}>strike_lock</span>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#fee2e2", color: "#991b1b" }}>39.G</span>
            <span style={{ fontSize: "0.625rem", color: "var(--color-muted)" }}>seq #{lockEvent.seq}</span>
          </div>
          <p style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "var(--color-muted)", margin: "0.375rem 0 0" }}>
            hash: {lockEvent.hash}... · prev: {lockEvent.prevHash}...
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Compliance Ledger View ───────────────────────────────────────────────────

function ComplianceLedgerView() {
  const tip = COMPLIANCE_EVENTS[COMPLIANCE_EVENTS.length - 1];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.25rem" }}>Compliance</p>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Ledger</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.75rem", border: "1px solid #bbf7d0", borderRadius: "var(--radius)", background: "#f0fdf4", fontSize: "0.75rem", color: "#166534", fontWeight: 600 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Chain verified
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          {COMPLIANCE_EVENTS.length} events · SAG-AFTRA · Blade Runner 3
        </p>

        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2rem 1fr 3.5rem 1fr 6rem", gap: "1rem", padding: "0.5rem 1rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            {["#", "Event", "Clause", "Actor", "Hash"].map((h) => (
              <p key={h} style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>{h}</p>
            ))}
          </div>

          {COMPLIANCE_EVENTS.map((event, i) => {
            const isStrike = event.eventType === "strike_lock";
            return (
              <div
                key={event.seq}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2rem 1fr 3.5rem 1fr 6rem",
                  gap: "1rem",
                  alignItems: "center",
                  padding: "0.75rem 1rem",
                  borderBottom: i < COMPLIANCE_EVENTS.length - 1 ? "1px solid var(--color-border)" : "none",
                  background: isStrike ? "#fef2f2" : "var(--color-bg)",
                }}
              >
                <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-muted)" }}>{event.seq}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", minWidth: 0 }}>
                  <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: event.colour, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: isStrike ? "#991b1b" : "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.label}</span>
                </div>
                <span style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "2px", background: "#f1f5f9", color: "var(--color-muted)", display: "inline-block" }}>{event.clauseRef}</span>
                <span style={{ fontSize: "0.75rem", color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.actor.split(" — ")[0]}</span>
                <span style={{ fontSize: "0.6875rem", fontFamily: "monospace", color: "var(--color-muted)" }}>{event.hash}...</span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "0.875rem 1rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.25rem" }}>Ledger tip hash</p>
            <p style={{ fontSize: "0.8125rem", fontFamily: "monospace", color: "var(--color-ink)", margin: 0 }}>{tip.hash}...</p>
          </div>
          <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Certificate View ─────────────────────────────────────────────────────────

function CertificateView() {
  const tip = COMPLIANCE_EVENTS[COMPLIANCE_EVENTS.length - 1];
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.25rem" }}>Compliance</p>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Certificates</h1>
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.875rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Generate
        </button>
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", maxWidth: "36rem" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: "2.25rem", height: "2.25rem", borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </div>
            <div>
              <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)", margin: "0 0 0.1rem" }}>Compliance Certificate</p>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>Generated {formatDate(tip.ts)}</p>
            </div>
          </div>
          <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.2rem 0.6rem", borderRadius: "9999px", background: "#dcfce7", color: "#166534", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Verified
          </span>
        </div>

        <div style={{ padding: "0 1.5rem" }}>
          {[
            { label: "Scope", value: "Licence — Blade Runner 3" },
            { label: "Talent", value: "Emma Richardson" },
            { label: "Production", value: "Warner Bros. Pictures" },
            { label: "Regime", value: "SAG-AFTRA Article 39" },
            { label: "Events", value: `${COMPLIANCE_EVENTS.length} (consent, usage, file access, strike lock)` },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.75rem 0", borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <span style={{ fontSize: "0.8125rem", color: "var(--color-muted)", flexShrink: 0 }}>{row.label}</span>
              <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--color-ink)", textAlign: "right" }}>{row.value}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--color-border)", background: "#f8fafc" }}>
          <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>Ledger tip hash (SHA-256)</p>
          <p style={{ fontSize: "0.8125rem", fontFamily: "monospace", color: "var(--color-ink)", margin: "0 0 1rem", wordBreak: "break-all" }}>
            {tip.hash}7a2f4d9c8b3e1a6f2d5c...
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem", padding: "0.625rem", fontSize: "0.75rem", fontWeight: 500, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </button>
            <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem", padding: "0.625rem", fontSize: "0.75rem", fontWeight: 500, border: "none", borderRadius: "var(--radius)", background: "var(--color-accent)", color: "#fff", cursor: "default" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              Send to union
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tour card ────────────────────────────────────────────────────────────────

function TourCard({
  scene,
  sceneIndex,
  total,
  paused,
  mode,
  onModeChange,
  onPrev,
  onNext,
  onMouseEnter,
  onMouseLeave,
}: {
  scene: Scene;
  sceneIndex: number;
  total: number;
  paused: boolean;
  mode: DemoMode;
  onModeChange: (m: DemoMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(560px, calc(100% - 3rem))",
        background: "rgba(10,10,10,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: "8px",
        padding: "1.25rem 1.5rem",
        color: "#fff",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07)",
        zIndex: 40,
      }}
    >
      {/* Mode switcher */}
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.875rem", justifyContent: "center" }}>
        {(["production", "compliance"] as DemoMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              padding: "0.3rem 1rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              borderRadius: "4px",
              border: "1px solid",
              borderColor: mode === m ? "#c0392b" : "rgba(255,255,255,0.12)",
              background: mode === m ? "#c0392b" : "transparent",
              color: mode === m ? "#fff" : "rgba(255,255,255,0.45)",
              cursor: "pointer",
              letterSpacing: "0.04em",
              transition: "all 0.15s ease",
            }}
          >
            {m === "production" ? "Production Co." : "Compliance"}
          </button>
        ))}
      </div>

      {/* Progress dots */}
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

      <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: "0 0 0.375rem", letterSpacing: "-0.01em" }}>
        {scene.headline}
      </h3>
      <p style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.6)", margin: "0 0 1rem", lineHeight: 1.65 }}>
        {scene.body}
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onPrev} style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", background: "transparent", color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prev
        </button>

        <span style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {paused ? "Paused" : "Auto-playing"} · {sceneIndex + 1} / {total}
        </span>

        <button onClick={onNext} style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "none", borderRadius: "4px", background: "#c0392b", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          Next
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Mobile gate ──────────────────────────────────────────────────────────────

function MobileGate() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", padding: "2.5rem 2rem", background: "var(--color-bg)", textAlign: "center" }}>
      <div style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 500, letterSpacing: "0.05em", color: "var(--color-ink)" }}>Image Vault</div>
        <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b", margin: "0.375rem auto 0" }} />
      </div>
      <div style={{ marginBottom: "1.75rem", color: "var(--color-muted)" }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.75rem" }}>
        Best viewed on desktop
      </h1>
      <p style={{ fontSize: "0.9375rem", color: "var(--color-muted)", margin: 0, lineHeight: 1.65, maxWidth: "22rem" }}>
        This product tour is designed for larger screens. Open this link on a laptop or desktop for the full experience.
      </p>
    </div>
  );
}

// ─── Active nav mapping ───────────────────────────────────────────────────────

function getActiveNavId(view: ViewType): NavId {
  if (view === "production-list") return "productions";
  if (view === "cast-search" || view === "cast-list") return "cast";
  if (view === "licence-compliance") return "licences";
  if (view === "consent-dashboard" || view === "usage-events" || view === "strike-lock") return "dashboard";
  if (view === "compliance-ledger") return "ledger";
  return "certificates";
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DemoProductionClient() {
  const [isMobile] = useState<boolean | null>(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : null
  );
  const [mode, setMode] = useState<DemoMode>("production");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const scenes = mode === "production" ? PRODUCTION_SCENES : COMPLIANCE_SCENES;

  useEffect(() => {
    if (isMobile !== false || paused) return;
    const t = setTimeout(() => {
      setSceneIndex((i) => (i + 1) % scenes.length);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [sceneIndex, paused, mode, isMobile, scenes.length]);

  if (isMobile === null) return null;
  if (isMobile) return <MobileGate />;

  const scene = scenes[sceneIndex];

  const handleModeChange = (m: DemoMode) => {
    setMode(m);
    setSceneIndex(0);
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <style>{`
        @keyframes demo-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .demo-view-enter {
          animation: demo-fade-in 0.3s ease both;
        }
      `}</style>

      <DemoSidebar role={scene.sidebarRole} activeId={getActiveNavId(scene.view)} />

      <main style={{ flex: 1, overflow: "hidden", background: "var(--color-bg)", position: "relative", display: "flex", flexDirection: "column" }}>
        <div key={scene.id} className="demo-view-enter" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {scene.view === "production-list" && <ProductionListView />}
          {scene.view === "cast-search" && <CastSearchView />}
          {scene.view === "cast-list" && <CastListView />}
          {scene.view === "licence-compliance" && <LicenceComplianceView />}
          {scene.view === "consent-dashboard" && <ConsentDashboardView />}
          {scene.view === "usage-events" && <UsageEventsView />}
          {scene.view === "strike-lock" && <StrikeLockView />}
          {scene.view === "compliance-ledger" && <ComplianceLedgerView />}
          {scene.view === "certificate" && <CertificateView />}
        </div>

        <TourCard
          scene={scene}
          sceneIndex={sceneIndex}
          total={scenes.length}
          paused={paused}
          mode={mode}
          onModeChange={handleModeChange}
          onPrev={() => setSceneIndex((i) => (i - 1 + scenes.length) % scenes.length)}
          onNext={() => setSceneIndex((i) => (i + 1) % scenes.length)}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        />
      </main>
    </div>
  );
}
