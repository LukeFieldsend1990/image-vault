"use client";

import { useState, useEffect, useRef, createContext, useContext } from "react";

// True below the desktop breakpoint. Provided once by the root so the tour
// card and shell can adapt without their own media-query listeners; the scene
// views themselves adapt with responsive Tailwind classes.
const IsMobileContext = createContext(false);
const useIsMobile = () => useContext(IsMobileContext);

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType =
  | "productions-list"
  | "add-cast"
  | "incoming-request"
  | "my-productions"
  | "compliance-dashboard"
  | "compliance-modal";

type DemoMode = "production" | "talent" | "compliance";
type NavId = "directory" | "productions" | "licences" | "compliance" | "vault" | "settings";

interface Scene {
  id: string;
  view: ViewType;
  role: "production" | "talent";
  activeNav: NavId;
  headline: string;
  body: string;
}

const AUTO_MS = 11000;

// ─── Fake data ────────────────────────────────────────────────────────────────

const PRODUCTIONS = [
  {
    id: "p1",
    name: "Untitled The Batman Sequel",
    company: "Warner Bros",
    type: "feature_film",
    year: 2027,
    status: "pre_production",
    licenceCount: 0,
    sagProjectNumber: null as string | null,
    castTotal: 0,
    castConsented: 0,
  },
  {
    id: "p2",
    name: "Venom 4",
    company: null as string | null,
    type: null as string | null,
    year: null as number | null,
    status: null as string | null,
    licenceCount: 4,
    sagProjectNumber: null as string | null,
    castTotal: 1,
    castConsented: 1,
  },
];

const BATMAN_CAST = [
  { id: "rp", name: "Robert Pattinson", character: "Bruce Wayne / The Batman", checked: false },
  { id: "jw", name: "Jeffrey Wright", character: "Lt. James Gordon", checked: false },
  { id: "as", name: "Andy Serkis", character: "Alfred", checked: true },
  { id: "cf", name: "Colin Farrell", character: "Oz / The Penguin", checked: false },
  { id: "jl", name: "Jayme Lawson", character: "Bella Real", checked: true },
];

const TALENT_PRODUCTIONS = [
  {
    id: "tp1",
    typeLabel: "FEATURE FILM",
    year: 2026,
    name: "Venom 4",
    company: "Rumble Post",
    agreedFee: "$100,000",
    tags: ["FILM / DOUBLE", "Worldwide", "Sole"],
    dateFrom: "6 Jun 2026",
    dateTo: "30 Aug 2026",
    usage: "Digital double stunt purposes",
    noScan: true,
    previousAgreements: [
      { label: "7 Jun 2026 – 2 Aug 2026" },
      { label: "6 Jun 2026 – 9 Aug 2026" },
    ],
  },
  {
    id: "tp2",
    typeLabel: "AI PRODUCTION",
    year: 2026,
    name: "OpenAI Sora 3",
    company: "OpenAI",
    agreedFee: "$100,000",
    tags: ["AI AVATAR", "Worldwide", "Exclusive"],
    dateFrom: "1 May 2026",
    dateTo: "1 Aug 2026",
    usage: "Pay per generation content deal",
    noScan: false,
    previousAgreements: [],
  },
];

const OBLIGATIONS = [
  { clauseRef: "39.B", title: "Performer consent to the digital replica", count: "4/4", met: true, pending: 0 },
  { clauseRef: "39.E", title: "Biometric data isolation", count: "4/4", met: true, pending: 0 },
  { clauseRef: "39.H", title: "Replica security & custody", count: "4/4", met: true, pending: 0 },
  { clauseRef: "39.I", title: "Union-approved transfer", count: "—", met: true, pending: 0 },
  { clauseRef: "39.J", title: "Articulable business reason recorded", count: "4/4", met: true, pending: 0 },
  { clauseRef: "Scrub", title: "Replica deletion & scrub attestation", count: "—", met: false, pending: 4 },
];

const COMPLIANCE_PRODS = [
  { name: "Venom 4", type: "Production", licences: 1, score: 100, castPct: 100, castConsented: 1, castTotal: 1 },
  { name: "Calamity Hustle", type: "film", licences: 1, score: 100, castPct: 100, castConsented: 1, castTotal: 1 },
  { name: "ATB Series 2", type: "Production", licences: 2, score: 100, castPct: 100, castConsented: 2, castTotal: 2 },
];

const MODAL_OBLIGATIONS = [
  { clause: "39.B", title: "Performer consent to the digital replica", severity: "REQUIRED", status: "met" as const, eventLabel: "Consent granted", seq: 0, date: "31 May 2026", hash: "5c333f062995", meta: "use type: film double · territory: Worldwide" },
  { clause: "39.E", title: "Biometric data isolation", severity: "REQUIRED", status: "met" as const, eventLabel: "Biometric isolation attested", seq: 1, date: "31 May 2026", hash: "a968821d4005", meta: null },
  { clause: "39.H", title: "Replica security & custody", severity: "REQUIRED", status: "met" as const, eventLabel: "Security custody attested", seq: 2, date: "31 May 2026", hash: "616f027a13bd", meta: null },
  { clause: "39.J", title: "Articulable business reason recorded", severity: "RECOMMENDED", status: "met" as const, eventLabel: "Business reason recorded", seq: 3, date: "31 May 2026", hash: "d934fdaaa30e", meta: null },
  { clause: "Scrub", title: "Replica deletion & scrub attestation", severity: "REQUIRED", status: "pending" as const, eventLabel: null, seq: null, date: null, hash: null, meta: "Not yet required — obligation triggered on licence expiry" },
];

// ─── Scenes ───────────────────────────────────────────────────────────────────

const PRODUCTION_SCENES: Scene[] = [
  {
    id: "productions-list", view: "productions-list", role: "production", activeNav: "productions",
    headline: "Productions, cast, and compliance — in one place",
    body: "The Batman Sequel is in pre-production with no cast linked yet. Venom 4 has 4 licences running and full cast consent. Both managed from one view.",
  },
  {
    id: "add-cast", view: "add-cast", role: "production", activeNav: "productions",
    headline: "Import cast from the web",
    body: "Search for the production online and import the cast list. Check the ones you need, add email addresses. Invites fire instantly — each tied to the production's compliance regime and licence terms.",
  },
];

const TALENT_SCENES: Scene[] = [
  {
    id: "incoming-request", view: "incoming-request", role: "talent", activeNav: "licences",
    headline: "Cast invitation received",
    body: "Calamity Hustle proposes a Film / Double licence for $220,000. The talent can attach an existing scan or accept and get scanned as part of production.",
  },
  {
    id: "my-productions", view: "my-productions", role: "talent", activeNav: "licences",
    headline: "Every licence governing your likeness",
    body: "Venom 4 is active — Film / Double, $100k agreed fee. OpenAI Sora 3 runs an AI Avatar deal. Terms, territory, agreed fee, and usage are all visible.",
  },
];

const COMPLIANCE_SCENES: Scene[] = [
  {
    id: "compliance-dashboard", view: "compliance-dashboard", role: "production", activeNav: "compliance",
    headline: "100% compliant — every clause, every production",
    body: "SAG-AFTRA Article 39 obligations across all 4 productions. Consent, biometric isolation, security custody — all met. Scrub attestation is pending on licence expiry.",
  },
  {
    id: "compliance-modal", view: "compliance-modal", role: "production", activeNav: "compliance",
    headline: "Obligation-by-obligation audit trail",
    body: "Calamity Hustle: consent granted at seq 0, biometric isolation at seq 1, security custody at seq 2. Each event hash-linked. Scrub triggers on licence expiry.",
  },
];

// ─── Colour maps ──────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  pre_production: "#b45309",
  production: "#166534",
  post_production: "#7c3aed",
  development: "#6b7280",
  released: "#0891b2",
  cancelled: "#374151",
};

const STATUS_LABELS: Record<string, string> = {
  pre_production: "Pre-Production",
  production: "In Production",
  post_production: "Post-Production",
  development: "Development",
  released: "Released",
  cancelled: "Cancelled",
};

const TYPE_LABELS: Record<string, string> = {
  feature_film: "Feature Film",
  film: "Feature Film",
  tv_series: "TV Series",
};

const OBL_ICON: Record<string, string> = { met: "✓", pending: "⏳", gap: "⚠" };
const OBL_COLOR: Record<string, string> = { met: "#1a7f37", pending: "#2563eb", gap: "#c0392b" };

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const PRODUCTION_NAV: { id: NavId; label: string; icon: React.ReactNode }[] = [
  { id: "directory", label: "Directory", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
  { id: "productions", label: "Productions", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="16 2 12 7 8 2"/></svg> },
  { id: "licences", label: "Licences", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { id: "compliance", label: "Compliance", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
  { id: "settings", label: "Settings", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
];

const TALENT_NAV: { id: NavId; label: string; icon: React.ReactNode }[] = [
  { id: "vault", label: "Vault", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
  { id: "licences", label: "My Productions", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="16 2 12 7 8 2"/></svg> },
  { id: "settings", label: "Settings", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
];

const ROLE_USER = {
  talent: { initials: "ER", name: "Emma Richardson", subtitle: "Talent" },
  production: { initials: "WB", name: "Warner Bros.", subtitle: "Production Co." },
} as const;

function DemoSidebar({ role, activeNav }: { role: "production" | "talent"; activeNav: NavId }) {
  const nav = role === "talent" ? TALENT_NAV : PRODUCTION_NAV;
  const user = ROLE_USER[role];

  return (
    <aside style={{ width: "14rem", flexShrink: 0, background: "#0a0a0a", color: "#fff", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "2rem 0" }}>
        <div>
          <div style={{ padding: "0 1.5rem", marginBottom: "2.5rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>ImageVault</div>
            <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
          </div>
          <nav style={{ padding: "0 0.75rem" }}>
            {nav.map((item) => {
              const active = item.id === activeNav;
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 0.75rem", borderRadius: "0.25rem", marginBottom: "0.125rem", background: active ? "rgba(192,57,43,0.18)" : "transparent", borderLeft: active ? "3px solid #c0392b" : "3px solid transparent", color: active ? "#fff" : "rgba(255,255,255,0.45)", fontSize: "0.875rem", cursor: "default", userSelect: "none" }}>
                  {item.icon}
                  {item.label}
                </div>
              );
            })}
          </nav>
        </div>
        <div style={{ padding: "0 1.5rem" }}>
          <a
            href="/register-interest"
            style={{ display: "block", textAlign: "center", marginBottom: "1rem", padding: "0.5rem 0.75rem", background: "#c0392b", color: "#fff", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.04em", borderRadius: "4px", textDecoration: "none" }}
          >
            Get access →
          </a>
          <div style={{ marginBottom: "1rem", display: "inline-block", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", padding: "0.2rem 0.5rem", background: "rgba(192,57,43,0.15)", color: "#c0392b", borderRadius: "2px", border: "1px solid rgba(192,57,43,0.3)" }}>
            DEMO MODE
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: "1.75rem", height: "1.75rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {user.initials}
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#fff" }}>{user.name}</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)" }}>{user.subtitle}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── View: Productions List ───────────────────────────────────────────────────

function ProductionsListView() {
  return (
    <div className="p-4 md:p-8 max-w-4xl pb-[20rem] lg:pb-[13rem]" style={{ overflowY: "auto", height: "100%" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6 md:mb-10">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
            Your Productions
          </p>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
            Productions
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
            Manage cast, licences, and compliance for each production.
          </p>
        </div>
        <button className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white shrink-0 cursor-default" style={{ background: "var(--color-accent)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Production
        </button>
      </div>

      <div className="space-y-4">
        {PRODUCTIONS.map((p) => {
          const statusColour = p.status ? STATUS_COLOURS[p.status] : null;
          const statusLabel = p.status ? STATUS_LABELS[p.status] : null;
          const typeLabel = p.type ? TYPE_LABELS[p.type] ?? p.type : null;
          const castPct = p.castTotal > 0 ? Math.round((p.castConsented / p.castTotal) * 100) : 0;
          const castColour = castPct === 100 ? "#166534" : castPct > 50 ? "#b45309" : "#c0392b";

          return (
            <div key={p.id} className="block rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              {/* Header band */}
              <div className="px-4 md:px-6 pt-5 pb-5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    {typeLabel && <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{typeLabel}</span>}
                    {typeLabel && p.year && <span className="text-[10px]" style={{ color: "var(--color-border)" }}>·</span>}
                    {p.year && <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{p.year}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {statusColour && statusLabel && (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: statusColour }} />
                        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: statusColour }}>{statusLabel}</span>
                      </span>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-6">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold tracking-tight leading-none" style={{ color: "var(--color-ink)" }}>{p.name}</h2>
                    {p.company && <p className="mt-1.5 text-sm" style={{ color: "var(--color-muted)" }}>{p.company}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-semibold tabular-nums leading-none" style={{ color: "var(--color-ink)" }}>{p.licenceCount}</p>
                    <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>{p.licenceCount === 1 ? "Licence" : "Licences"}</p>
                  </div>
                </div>
              </div>
              {/* Footer band */}
              <div className="px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap" style={{ background: "var(--color-bg)" }}>
                <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {p.sagProjectNumber ? `SAG-AFTRA · ${p.sagProjectNumber}` : "No SAG-AFTRA project number"}
                </span>
                {p.castTotal > 0 ? (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{p.castConsented}/{p.castTotal} cast consented</span>
                    <span className="inline-flex w-20 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                      <span className="h-full rounded-full" style={{ width: `${castPct}%`, background: castColour }} />
                    </span>
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: castColour }}>{castPct}%</span>
                  </span>
                ) : (
                  <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded ml-auto" style={{ background: "rgba(180,83,9,0.08)", color: "#b45309" }}>
                    No cast added yet
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── View: Add Cast ───────────────────────────────────────────────────────────

function AddCastView() {
  return (
    <div className="pb-[20rem] lg:pb-[13rem]" style={{ overflowY: "auto", height: "100%" }}>
      <div className="max-w-2xl p-4 md:p-8">
        <div className="flex items-center gap-1.5 text-sm mb-5 cursor-default" style={{ color: "var(--color-muted)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Productions
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Untitled The Batman Sequel</h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>film</span>
          </div>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>Warner Bros · 2027 · Dir. Matt Reeves</p>
        </div>

        <div className="flex items-center justify-between mb-5">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
            Cast&nbsp;&nbsp;<span style={{ fontWeight: 400 }}>0 Members</span>
          </p>
          <button className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white cursor-default" style={{ background: "var(--color-accent)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Cast
          </button>
        </div>

        {/* ADD CAST MEMBERS */}
        <div className="rounded-lg overflow-hidden mb-6" style={{ border: "1px solid var(--color-border)" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>Add Cast Members</p>
            <div className="flex gap-2">
              {["Manual Entry", "Web Import", "CSV Upload"].map((tab) => (
                <button key={tab} className="rounded px-3 py-1.5 text-sm font-medium cursor-default" style={tab === "Web Import" ? { background: "var(--color-accent)", color: "#fff", border: "none" } : { background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {BATMAN_CAST.map((actor, i) => (
            <div key={actor.id} className="flex items-center justify-between flex-wrap gap-2 px-4 md:px-5 py-3" style={{ borderBottom: i < BATMAN_CAST.length - 1 ? "1px solid var(--color-border)" : "none", background: actor.checked ? "rgba(192,57,43,0.025)" : "var(--color-bg)" }}>
              <div className="flex items-center gap-3 min-w-0 flex-wrap">
                <div className="shrink-0 flex items-center justify-center" style={{ width: "1rem", height: "1rem", borderRadius: "3px", border: `2px solid ${actor.checked ? "var(--color-accent)" : "var(--color-border)"}`, background: actor.checked ? "var(--color-accent)" : "transparent" }}>
                  {actor.checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{actor.name}</span>
                <span className="text-sm" style={{ color: "var(--color-muted)" }}>as {actor.character}</span>
              </div>
              {actor.checked && (
                <div className="shrink-0 text-sm w-full md:w-44" style={{ padding: "0.375rem 0.625rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-muted)" }}>
                  Email address
                </div>
              )}
            </div>
          ))}
        </div>

        {/* LICENCE TERMS */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-muted)" }}>Licence Terms</p>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>These terms apply to all members in this batch. Terms copy forward from your previous entry.</p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Intended Use *</label>
              <div className="rounded px-3 py-2 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
                e.g. Digital double for VFX sequences
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Valid From *</label>
                <div className="rounded px-3 py-2 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>dd/mm/yyyy</div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Valid To *</label>
                <div className="rounded px-3 py-2 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>dd/mm/yyyy</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Licence Type</label>
                <div className="rounded px-3 py-2 text-sm flex items-center justify-between" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
                  <span>Film / Double</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Exclusivity</label>
                <div className="rounded px-3 py-2 text-sm flex items-center justify-between" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
                  <span>Non-exclusive</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Territory</label>
                <div className="rounded px-3 py-2 text-sm flex items-center justify-between" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
                  <span>Select territory...</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-muted)" }}>Proposed Fee ($)</label>
                <div className="rounded px-3 py-2 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>0</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── View: Incoming Request (Talent) ──────────────────────────────────────────

function IncomingRequestView() {
  return (
    <div className="p-4 md:p-8 max-w-4xl pb-[20rem] lg:pb-[13rem]" style={{ overflowY: "auto", height: "100%" }}>
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>Incoming Requests</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>Review and approve or deny licence requests from production companies.</p>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        {/* Request header */}
        <div className="px-4 md:px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <span className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold mb-3 cursor-default" style={{ background: "var(--color-accent)", color: "#fff" }}>
                CAST INVITATION
              </span>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>Calamity Hustle</h2>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>Film / Double</span>
              </div>
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>Production Company · Worldwide</p>
              <p className="text-sm font-medium mt-1" style={{ color: "var(--color-accent)" }}>Proposed fee: $220,000</p>
            </div>
            <button className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded cursor-default shrink-0" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-muted)" }}>
              Details
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        </div>

        {/* Package selector */}
        <div className="px-4 md:px-6 py-5" style={{ background: "var(--color-bg)" }}>
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
            Attach an existing scan package, or accept and get scanned as part of the production.
          </p>
          <div className="flex gap-3 mb-5 flex-wrap">
            <div className="flex-1 flex items-center justify-between rounded px-3 py-2.5 text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
              <span>— select a package —</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <button className="rounded px-4 py-2.5 text-sm font-medium cursor-default" style={{ background: "rgba(192,57,43,0.4)", color: "#fff" }}>
              Attach Package
            </button>
          </div>
          <div className="flex items-center gap-3 md:gap-4 flex-wrap">
            <button className="rounded px-5 py-2.5 text-sm font-medium text-white cursor-default" style={{ background: "var(--color-accent)" }}>
              Accept — get scanned later
            </button>
            <button className="text-sm cursor-default" style={{ color: "var(--color-muted)", background: "none", border: "none" }}>
              Decline invitation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── View: My Productions (Talent) ────────────────────────────────────────────

function MyProductionsView() {
  return (
    <div className="p-4 md:p-8 max-w-3xl pb-[20rem] lg:pb-[13rem]" style={{ overflowY: "auto", height: "100%" }}>
      <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Vault</p>
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>My Productions</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        Productions you{"'"}ve been engaged on and the licences governing your likeness.
      </p>

      <div className="space-y-5">
        {TALENT_PRODUCTIONS.map((prod) => (
          <div key={prod.id} className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            {/* Top */}
            <div className="px-4 md:px-6 pt-5 pb-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{prod.typeLabel}</span>
                  <span className="text-[10px]" style={{ color: "var(--color-border)" }}>·</span>
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{prod.year}</span>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#166534" }}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#166534" }} />
                  Active
                </span>
              </div>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>{prod.name}</h2>
                  <p className="text-sm mt-0.5" style={{ color: "var(--color-muted)" }}>{prod.company}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>{prod.agreedFee}</p>
                  <p className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: "var(--color-muted)" }}>Agreed Fee</p>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="px-4 md:px-6 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {prod.tags.map((tag, i) => (
                  <span key={tag} className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-default" style={i === 0 ? { background: "var(--color-ink)", color: "#fff" } : { background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-sm mb-1" style={{ color: "var(--color-ink)" }}>
                {prod.dateFrom} → {prod.dateTo}
              </p>
              <p className="text-sm mb-3" style={{ color: "var(--color-muted)" }}>Usage: {prod.usage}</p>

              {prod.noScan && (
                <div className="flex items-center justify-between gap-3 md:gap-4 flex-wrap rounded px-4 py-3 mb-3" style={{ background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.15)" }}>
                  <p className="text-xs" style={{ color: "#92400e" }}>
                    No scan package attached — you may be scanned as part of production.
                  </p>
                  <button className="text-xs font-medium shrink-0 cursor-default" style={{ color: "var(--color-accent)" }}>
                    Attach scan →
                  </button>
                </div>
              )}

              <div className="flex justify-end">
                <button className="text-xs font-medium cursor-default" style={{ color: "var(--color-accent)", background: "none", border: "none" }}>
                  View licence agreement →
                </button>
              </div>
            </div>

            {/* Previous agreements */}
            {prod.previousAgreements.length > 0 && (
              <div className="px-4 md:px-6 py-3" style={{ background: "var(--color-bg)" }}>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>Previous Agreements</p>
                <div className="space-y-1.5">
                  {prod.previousAgreements.map((ag) => (
                    <div key={ag.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "rgba(107,114,128,0.1)", color: "#6b7280", border: "1px solid rgba(107,114,128,0.2)" }}>REVOKED</span>
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ag.label}</span>
                      </div>
                      <button className="text-xs cursor-default" style={{ color: "var(--color-accent)", background: "none", border: "none" }}>View →</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── View: Compliance Dashboard ───────────────────────────────────────────────

function ComplianceDashboardView({ showModal }: { showModal?: boolean }) {
  const circ52 = 2 * Math.PI * 52;
  const circ22 = 2 * Math.PI * 22;
  const color = "#1a7f37";

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <div className="max-w-5xl mx-auto px-4 py-5 md:px-8 md:py-8 space-y-6 pb-[20rem] lg:pb-[13rem]" style={{ overflowY: "auto", height: "100%", filter: showModal ? "brightness(0.4)" : "none" }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>Compliance Control Centre</h1>
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              SAG-AFTRA Article 39&nbsp;&nbsp;·&nbsp;&nbsp;2026 TV/Theatrical AI&nbsp;&nbsp;·&nbsp;&nbsp;
              <span style={{ color: "var(--color-accent)" }}>RUMBLE POST +</span>
            </p>
          </div>
          <button className="rounded px-4 py-2 text-sm font-medium text-white shrink-0 cursor-default" style={{ background: "var(--color-accent)" }}>
            Generate Certificate
          </button>
        </div>

        {/* Stats row */}
        <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 rounded-lg p-4 md:p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          {/* Ring */}
          <div className="shrink-0">
            <svg width="128" height="128" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="52" fill="none" stroke="var(--color-border)" strokeWidth="8" />
              <circle cx="64" cy="64" r="52" fill="none" stroke={color} strokeWidth="8" strokeDasharray={circ52} strokeDashoffset={0} strokeLinecap="round" transform="rotate(-90 64 64)" />
              <text x="64" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--color-text)">100%</text>
              <text x="64" y="78" textAnchor="middle" fontSize="10" fill={color} style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Compliant</text>
            </svg>
          </div>
          {/* Stat cards */}
          <div className="flex gap-3 md:gap-5 flex-wrap justify-center md:justify-start">
            {[
              { value: "5", label: "Licences" },
              { value: "4/4", label: "Productions" },
              { value: "0", label: "Required Gaps" },
              { value: "0", label: "Active Strikes" },
              { value: "0", label: "Pending Transfers" },
            ].map((s) => (
              <div key={s.label} className="rounded p-4 flex flex-col gap-1 min-w-[90px]" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                <span className="text-2xl font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>{s.value}</span>
                <span className="text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Obligation progress */}
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-[10px] uppercase tracking-widest font-semibold px-5 py-3" style={{ color: "var(--color-muted)", borderBottom: "1px solid var(--color-border)" }}>
            Obligation Progress
          </p>
          <div className="px-5">
            {OBLIGATIONS.map((ob) => (
              <div key={ob.clauseRef} className="flex items-center gap-2.5 md:gap-4 py-2.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <span className="text-xs font-mono w-10 md:w-12 shrink-0" style={{ color: "var(--color-muted)" }}>{ob.clauseRef}</span>
                <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "var(--color-text)" }}>{ob.title}</span>
                <div className="w-32 shrink-0 hidden md:block">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    {ob.met && ob.count !== "—" && (
                      <div className="h-full rounded-full" style={{ width: "100%", background: color }} />
                    )}
                  </div>
                </div>
                <span className="text-xs tabular-nums w-10 text-right shrink-0" style={{ color: "var(--color-muted)" }}>{ob.count}</span>
                <span className="text-[10px] uppercase tracking-widest w-auto md:w-24 text-right shrink-0 font-medium" style={{ color: ob.met ? color : "#2563eb" }}>
                  {ob.met ? "✓ Met" : `⏳ ${ob.pending} pending`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Productions grid */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-muted)" }}>
            Productions ({COMPLIANCE_PRODS.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COMPLIANCE_PRODS.map((prod) => (
              <div key={prod.name} className="rounded p-4 flex flex-col gap-3 cursor-default" style={{ border: `1px solid ${color}33`, background: "var(--color-surface)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm" style={{ color: "var(--color-text)" }}>{prod.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{prod.type} · {prod.licences} licence{prod.licences !== 1 ? "s" : ""}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded shrink-0 font-medium" style={{ background: "rgba(26,127,55,0.08)", color, border: `1px solid ${color}44` }}>
                    Compliant
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
                    <svg width="56" height="56" viewBox="0 0 56 56">
                      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--color-border)" strokeWidth="5" />
                      <circle cx="28" cy="28" r="22" fill="none" stroke={color} strokeWidth="5" strokeDasharray={circ22} strokeDashoffset={0} strokeLinecap="round" transform="rotate(-90 28 28)" />
                    </svg>
                    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, color, lineHeight: 1 }}>100%</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    {["39.B Performer consent to the di...", "39.E Biometric data isolation", "39.H Replica security & custody", "⏳ Scrub Replica deletion & scrub a..."].map((line) => (
                      <div key={line} className="flex items-center gap-1.5 text-xs overflow-hidden" style={{ color: "var(--color-muted)" }}>
                        <span className="shrink-0" style={{ color: line.startsWith("⏳") ? "#2563eb" : color }}>
                          {line.startsWith("⏳") ? "⏳" : "✓"}
                        </span>
                        <span className="truncate">{line.startsWith("⏳") ? line.slice(2) : line}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded p-2.5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "var(--color-muted)" }}>Cast Onboarding</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color }}>
                      {prod.castConsented}/{prod.castTotal}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${prod.castPct}%`, background: color }} />
                  </div>
                  <p className="text-[10px] mt-1" style={{ color }}>✓ All cast onboarded</p>
                </div>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)", opacity: 0.7 }}>Click for details →</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && <ComplianceModal />}
    </div>
  );
}

// ─── Compliance Modal ─────────────────────────────────────────────────────────

function ComplianceModal() {
  return (
    <div className="items-start pt-5 md:items-center md:pt-0" style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div className="p-4 md:p-6 max-h-[70vh] md:max-h-[85vh] w-[calc(100%-1.5rem)] md:w-[min(92%,700px)]" style={{ overflowY: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "10px", pointerEvents: "auto" }}>
        {/* Modal header */}
        <div className="flex items-start justify-between gap-3 md:gap-4 mb-5 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>Calamity Hustle</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              film · 1 licence ·{" "}
              <span style={{ color: "#1a7f37", fontWeight: 600 }}>100% Compliant</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="text-xs px-3 py-1.5 rounded cursor-default" style={{ background: "var(--color-accent)", color: "#fff" }}>
              Generate Certificate
            </button>
            <button className="cursor-default" style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: "20px", lineHeight: 1, padding: "0 4px" }}>×</button>
          </div>
        </div>

        {/* Licence panel */}
        <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          <div className="flex items-center justify-between px-3 py-2 gap-3" style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
            <div>
              <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>ef94ea37</span>
              <span className="text-xs ml-2" style={{ color: "var(--color-text)" }}>Calamity Hustle</span>
              <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>· film double · APPROVED</span>
            </div>
          </div>

          {MODAL_OBLIGATIONS.map((o) => {
            const ic = OBL_COLOR[o.status] ?? "#aaa";
            return (
              <div key={o.clause} className="flex items-start gap-3 px-3 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
                <span className="text-sm mt-0.5 shrink-0 w-4 text-center" style={{ color: ic }}>
                  {OBL_ICON[o.status] ?? "—"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                    <span className="font-mono mr-1.5" style={{ color: "var(--color-muted)" }}>{o.clause}</span>
                    {o.title}
                  </p>
                  {o.status === "met" && o.eventLabel && (
                    <div style={{ marginTop: "3px" }}>
                      <span className="font-mono text-[10px]" style={{ color: ic }}>{o.eventLabel}</span>
                      <span className="text-[10px]" style={{ color: "#999" }}>
                        {" "}· seq {o.seq} · {o.date} · <code style={{ fontFamily: "ui-monospace,monospace" }}>{o.hash}…</code>
                      </span>
                      {o.meta && <p className="text-[10px] mt-0.5" style={{ color: "#aaa" }}>{o.meta}</p>}
                    </div>
                  )}
                  {o.status === "pending" && (
                    <p className="text-[10px] mt-0.5" style={{ color: ic }}>{o.meta}</p>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-widest shrink-0" style={{ color: "var(--color-muted)" }}>{o.severity}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Tour card ────────────────────────────────────────────────────────────────

function TourCard({
  scene, sceneIndex, total, paused, mode,
  onModeChange, onPrev, onNext, onMouseEnter, onMouseLeave,
}: {
  scene: Scene; sceneIndex: number; total: number; paused: boolean; mode: DemoMode;
  onModeChange: (m: DemoMode) => void; onPrev: () => void; onNext: () => void;
  onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const mobile = useIsMobile();
  const modes: { id: DemoMode; label: string }[] = [
    { id: "production", label: "Production Co." },
    { id: "talent", label: "Talent" },
    { id: "compliance", label: "Compliance" },
  ];

  return (
    <div
      // Hover-pause is desktop-only: on touch devices taps fire synthetic
      // mouseenter with no mouseleave to follow, which would stick the tour
      // paused. Phones pause via press-and-hold on the shell instead.
      onMouseEnter={mobile ? undefined : onMouseEnter}
      onMouseLeave={mobile ? undefined : onMouseLeave}
      style={{ position: "absolute", bottom: mobile ? "calc(0.625rem + env(safe-area-inset-bottom))" : "1.5rem", left: "50%", transform: "translateX(-50%)", width: mobile ? "calc(100% - 1.25rem)" : "min(600px, calc(100% - 3rem))", background: "rgba(10,10,10,0.93)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderRadius: "8px", padding: mobile ? "0.875rem 1rem" : "1.25rem 1.5rem", color: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07)", zIndex: 50 }}
    >
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.875rem", justifyContent: "center", flexWrap: "wrap" }}>
        {modes.map((m) => (
          <button key={m.id} onClick={() => onModeChange(m.id)} style={{ padding: "0.3rem 0.875rem", fontSize: "0.6875rem", fontWeight: 600, borderRadius: "4px", border: "1px solid", borderColor: mode === m.id ? "#c0392b" : "rgba(255,255,255,0.12)", background: mode === m.id ? "#c0392b" : "transparent", color: mode === m.id ? "#fff" : "rgba(255,255,255,0.45)", cursor: "pointer", letterSpacing: "0.03em", transition: "all 0.15s ease" }}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.875rem", justifyContent: "center" }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ width: i === sceneIndex ? "1.5rem" : "0.375rem", height: "0.375rem", borderRadius: "9999px", background: i === sceneIndex ? "#c0392b" : "rgba(255,255,255,0.2)", transition: "width 0.3s ease, background 0.3s ease" }} />
        ))}
      </div>

      <h3 style={{ fontSize: mobile ? "0.875rem" : "0.9375rem", fontWeight: 600, margin: "0 0 0.375rem", letterSpacing: "-0.01em", color: "#fff" }}>{scene.headline}</h3>
      <p style={{ fontSize: mobile ? "0.75rem" : "0.8125rem", color: "rgba(255,255,255,0.6)", margin: mobile ? "0 0 0.75rem" : "0 0 1rem", lineHeight: mobile ? 1.55 : 1.65 }}>{scene.body}</p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onPrev} style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", background: "transparent", color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Prev
        </button>
        <span style={{ fontSize: mobile ? "0.625rem" : "0.6875rem", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {paused ? "Paused" : mobile ? "Swipe" : "Auto-playing"} · {sceneIndex + 1} / {total}
        </span>
        <button onClick={onNext} style={{ fontSize: "0.75rem", fontWeight: 500, padding: "0.375rem 0.875rem", border: "none", borderRadius: "4px", background: "#c0392b", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.375rem" }}>
          Next
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>
  );
}

// ─── Mobile top bar ──────────────────────────────────────────────────────────
// Phones swap the 14rem sidebar for this compact bar: wordmark, DEMO MODE
// chip, and the acting-as user for the current scene's role.

function MobileTopBar({ role }: { role: "production" | "talent" }) {
  const user = ROLE_USER[role];
  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.625rem 1rem", paddingTop: "calc(0.625rem + env(safe-area-inset-top))", background: "#0a0a0a", color: "#fff" }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>ImageVault</div>
        <div style={{ marginTop: "0.25rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
      </div>
      <a href="/register-interest" style={{ fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.03em", padding: "0.375rem 0.75rem", background: "#c0392b", color: "#fff", borderRadius: "4px", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
        Get access
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <div style={{ minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</div>
          <div style={{ fontSize: "0.5625rem", color: "rgba(255,255,255,0.45)" }}>{user.subtitle}</div>
        </div>
        <div style={{ width: "1.625rem", height: "1.625rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
          {user.initials}
        </div>
      </div>
    </div>
  );
}

// ─── Intro overlay ───────────────────────────────────────────────────────────
// One-line explainer shown before the tour starts. Dismisses on click/tap and
// auto-fades after a few seconds; the tour holds until it has cleared.

const INTRO_HOLD_MS = 3200;
const INTRO_FADE_MS = 500;

type IntroState = "visible" | "leaving" | "gone";

function IntroOverlay({ leaving, onDismiss }: { leaving: boolean; onDismiss: () => void }) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        opacity: leaving ? 0 : 1,
        transition: `opacity ${INTRO_FADE_MS}ms ease`,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          maxWidth: "26rem",
          width: "100%",
          background: "rgba(10,10,10,0.96)",
          borderRadius: "10px",
          padding: "2rem 2.25rem",
          textAlign: "center",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
          animation: "demo-intro-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>
          ImageVault
        </div>
        <div style={{ height: "1px", width: "1.5rem", background: "#c0392b", margin: "0.5rem auto 1.25rem" }} />
        <p style={{ fontSize: "0.9375rem", color: "rgba(255,255,255,0.85)", lineHeight: 1.7, margin: 0 }}>
          A service where talent has custody of their digital scans and likeness —
          licensing to productions, and protected against AI misuse.
        </p>
        <p style={{ margin: "1.25rem 0 0", fontSize: "0.625rem", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
          Tap anywhere to start the tour
        </p>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

const ALL_SCENES: Record<DemoMode, Scene[]> = {
  production: PRODUCTION_SCENES,
  talent: TALENT_SCENES,
  compliance: COMPLIANCE_SCENES,
};

export default function DemoProductionClient() {
  // Starts null (matching the server render) and resolves in the effect below —
  // resolving from `window` during hydration would mismatch the server HTML.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [mode, setMode] = useState<DemoMode>("production");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [intro, setIntro] = useState<IntroState>("visible");
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Track rotation / resize across the breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Intro overlay: auto-fade after a short hold, then unmount once faded.
  useEffect(() => {
    if (intro === "gone") return;
    const t = setTimeout(
      () => setIntro(intro === "visible" ? "leaving" : "gone"),
      intro === "visible" ? INTRO_HOLD_MS : INTRO_FADE_MS
    );
    return () => clearTimeout(t);
  }, [intro]);

  const scenes = ALL_SCENES[mode];
  const scene = scenes[sceneIndex];

  useEffect(() => {
    if (isMobile === null || paused || intro !== "gone") return;
    const t = setTimeout(() => setSceneIndex((i) => (i + 1) % scenes.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [sceneIndex, paused, mode, isMobile, intro, scenes.length]);

  if (isMobile === null) return null;

  const handleModeChange = (m: DemoMode) => {
    setMode(m);
    setSceneIndex(0);
  };

  const goPrev = () => setSceneIndex((i) => (i - 1 + scenes.length) % scenes.length);
  const goNext = () => setSceneIndex((i) => (i + 1) % scenes.length);

  return (
    <IsMobileContext.Provider value={isMobile}>
    <div
      className="demo-prod-shell"
      style={{ display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}
      // Stories-style touch controls: press-and-hold pauses, a horizontal
      // swipe steps between scenes.
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
      <style>{`
        .demo-prod-shell { height: 100vh; height: 100dvh; }
        @keyframes demo-intro-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      {intro !== "gone" && (
        <IntroOverlay leaving={intro === "leaving"} onDismiss={() => setIntro("leaving")} />
      )}
      {isMobile
        ? <MobileTopBar role={scene.role} />
        : <DemoSidebar role={scene.role} activeNav={scene.activeNav} />}

      <main style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "var(--color-bg)", position: "relative", display: "flex", flexDirection: "column" }}>
        {/* Keyed on the intro too, so scene entrance animations replay the
            moment the overlay clears instead of finishing behind it. */}
        <div key={`${scene.id}-${intro === "gone"}`} className="demo-view-enter" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {scene.view === "productions-list" && <ProductionsListView />}
          {scene.view === "add-cast" && <AddCastView />}
          {scene.view === "incoming-request" && <IncomingRequestView />}
          {scene.view === "my-productions" && <MyProductionsView />}
          {scene.view === "compliance-dashboard" && <ComplianceDashboardView />}
          {scene.view === "compliance-modal" && <ComplianceDashboardView showModal />}
        </div>

        <TourCard
          scene={scene} sceneIndex={sceneIndex} total={scenes.length} paused={paused} mode={mode}
          onModeChange={handleModeChange}
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
