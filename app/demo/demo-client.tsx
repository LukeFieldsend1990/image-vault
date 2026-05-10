"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LicenceStatus = "APPROVED" | "PENDING" | "DENIED";

interface FakePkg {
  id: string;
  name: string;
  studioName: string;
  captureDate: number;
  fileCount: number;
  totalSizeBytes: number;
  scanType: string;
  hasMesh: boolean;
  hasTexture: boolean;
  hasHdr: boolean;
  hasMotionCapture: boolean;
  tags: string[];
}

interface FakeFile {
  id: string;
  filename: string;
  sizeBytes: number;
}

interface FakeLicence {
  id: string;
  projectName: string;
  status: LicenceStatus;
  licenceType: string;
  productionCompany: string;
  packageName: string;
  packageScanType: string;
  packageHasMesh: boolean;
  packageHasTexture: boolean;
  packageHasHdr: boolean;
  packageHasMotionCapture: boolean;
  packageTags: string[];
  validFrom: number;
  validTo: number;
  territory: string;
  exclusivity: string;
  permitAiTraining: boolean;
  agreedFee: number | null;
  proposedFee: number | null;
  intendedUse: string;
  approvedAt: number | null;
  downloadCount: number;
  lastDownloadAt: number | null;
}

interface Scene {
  id: string;
  view: "vault" | "licences";
  expandedPkg: string | null;
  expandedLic: string | null;
  headline: string;
  body: string;
  highlightDownload?: boolean;
}

// ─── Fake data ────────────────────────────────────────────────────────────────

const PACKAGES: FakePkg[] = [
  {
    id: "pkg-1",
    name: "Full Body — Framestore London",
    studioName: "Framestore",
    captureDate: 1704067200,
    fileCount: 847,
    totalSizeBytes: 443208310784,
    scanType: "light_stage",
    hasMesh: true,
    hasTexture: true,
    hasHdr: true,
    hasMotionCapture: false,
    tags: ["4K plates", "per-light EXR", "albedo"],
  },
  {
    id: "pkg-2",
    name: "Expression Range — Weta Wellington",
    studioName: "Weta Digital",
    captureDate: 1714521600,
    fileCount: 234,
    totalSizeBytes: 95737004032,
    scanType: "photogrammetry",
    hasMesh: true,
    hasTexture: true,
    hasHdr: false,
    hasMotionCapture: false,
    tags: ["blendshapes", "neutral", "extreme"],
  },
  {
    id: "pkg-3",
    name: "Motion Reference — ILM Singapore",
    studioName: "Industrial Light & Magic",
    captureDate: 1719792000,
    fileCount: 156,
    totalSizeBytes: 25166798848,
    scanType: "other",
    hasMesh: false,
    hasTexture: false,
    hasHdr: false,
    hasMotionCapture: true,
    tags: ["BVH", "C3D", "facial mocap"],
  },
];

const PKG1_FILES: FakeFile[] = [
  { id: "f1", filename: "per_light_exr_set_01.zip", sizeBytes: 187904819200 },
  { id: "f2", filename: "albedo_maps_8k.zip", sizeBytes: 96636764160 },
  { id: "f3", filename: "mesh_scan_v2.obj", sizeBytes: 73818071040 },
  { id: "f4", filename: "hdri_capture_360.exr", sizeBytes: 50465865728 },
  { id: "f5", filename: "raw_plates_cam01-16.zip", sizeBytes: 34359738368 },
];

const LICENCES: FakeLicence[] = [
  {
    id: "lic-1",
    projectName: "Blade Runner 3",
    status: "APPROVED",
    licenceType: "film_double",
    productionCompany: "Warner Bros. Pictures",
    packageName: "Full Body — Framestore London",
    packageScanType: "light_stage",
    packageHasMesh: true,
    packageHasTexture: true,
    packageHasHdr: true,
    packageHasMotionCapture: false,
    packageTags: ["4K plates", "per-light EXR"],
    validFrom: 1704067200,
    validTo: 1767139200,
    territory: "Worldwide",
    exclusivity: "non_exclusive",
    permitAiTraining: false,
    agreedFee: 8500000,
    proposedFee: null,
    intendedUse:
      "Digital double for principal photography sequences and VFX work on Blade Runner 3, including close-up facial replacement and full-body simulation.",
    approvedAt: 1714521600,
    downloadCount: 3,
    lastDownloadAt: 1719792000,
  },
  {
    id: "lic-2",
    projectName: "EA Sports FC 2026",
    status: "PENDING",
    licenceType: "game_character",
    productionCompany: "Electronic Arts Ltd",
    packageName: "Full Body — Framestore London",
    packageScanType: "light_stage",
    packageHasMesh: true,
    packageHasTexture: true,
    packageHasHdr: false,
    packageHasMotionCapture: false,
    packageTags: ["4K plates"],
    validFrom: 1735689600,
    validTo: 1767225600,
    territory: "Worldwide",
    exclusivity: "exclusive",
    permitAiTraining: false,
    agreedFee: null,
    proposedFee: 4200000,
    intendedUse:
      "Photorealistic in-game player character model for EA Sports FC 2026, used across all platforms and marketing materials.",
    approvedAt: null,
    downloadCount: 0,
    lastDownloadAt: null,
  },
  {
    id: "lic-3",
    projectName: "Nike: Just Move",
    status: "APPROVED",
    licenceType: "commercial",
    productionCompany: "Nike Inc",
    packageName: "Expression Range — Weta Wellington",
    packageScanType: "photogrammetry",
    packageHasMesh: true,
    packageHasTexture: true,
    packageHasHdr: false,
    packageHasMotionCapture: false,
    packageTags: ["blendshapes"],
    validFrom: 1704067200,
    validTo: 1735689600,
    territory: "European Union",
    exclusivity: "sole",
    permitAiTraining: false,
    agreedFee: 2850000,
    proposedFee: null,
    intendedUse:
      "Digital likeness for Nike Just Move campaign, digital outdoor advertising and social media across the European Union.",
    approvedAt: 1706745600,
    downloadCount: 1,
    lastDownloadAt: 1709424000,
  },
];

// ─── Tour scenes ──────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: "vault-overview",
    view: "vault",
    expandedPkg: null,
    expandedLic: null,
    headline: "Your secure, encrypted vault",
    body: "Every scan package is encrypted in the browser before upload. Not even we can access your files.",
  },
  {
    id: "vault-files",
    view: "vault",
    expandedPkg: "pkg-1",
    expandedLic: null,
    headline: "Complete scan archive",
    body: "Packages bundle raw plates, EXRs, meshes, textures, and HDR maps — with a full chain-of-custody audit log.",
  },
  {
    id: "licences-overview",
    view: "licences",
    expandedPkg: null,
    expandedLic: null,
    headline: "Formal licensing workflow",
    body: "Production companies request access by project, usage type, territory, and term. You approve or deny every request.",
  },
  {
    id: "licence-detail",
    view: "licences",
    expandedPkg: null,
    expandedLic: "lic-1",
    headline: "Scoped, time-limited access",
    body: "Each licence locks in exact usage rights — film double, game character, or commercial — with an agreed fee and hard expiry.",
  },
  {
    id: "download",
    view: "licences",
    expandedPkg: null,
    expandedLic: "lic-1",
    headline: "Dual-custody download",
    body: "Both parties authenticate with 2FA before any file can leave the vault. You stay in control of every access event.",
    highlightDownload: true,
  },
];

const AUTO_MS = 5500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US")}`;
}

// ─── Label maps ───────────────────────────────────────────────────────────────

const STATUS_COLOUR: Record<string, string> = {
  APPROVED: "#166534",
  PENDING: "#b45309",
  DENIED: "#991b1b",
};

const LICENCE_TYPE_LABEL: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial",
  ai_avatar: "AI Avatar",
  training_data: "AI Training Data",
  monitoring_reference: "Identity Reference",
};

const EXCLUSIVITY_LABEL: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

const SCAN_TYPE_LABEL: Record<string, string> = {
  light_stage: "Light Stage",
  photogrammetry: "Photogrammetry",
  lidar: "LiDAR",
  structured_light: "Structured Light",
  other: "Other",
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    id: "vault",
    label: "Dashboard",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    id: "licences",
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
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
] as const;

function DemoSidebar({ activeView }: { activeView: "vault" | "licences" }) {
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
          {/* Logo */}
          <a href="/demo" style={{ display: "block", padding: "0 1.5rem", marginBottom: "2.5rem", textDecoration: "none" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>
              Image Vault
            </div>
            <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
          </a>

          {/* Nav */}
          <nav style={{ padding: "0 0.75rem" }}>
            {NAV_ITEMS.map((item) => {
              const active = item.id === activeView;
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
                    transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
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

        {/* User + demo badge */}
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
                flexShrink: 0,
                letterSpacing: "0.05em",
              }}
            >
              ER
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#fff" }}>Emma Richardson</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}>
                Talent
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Vault view ───────────────────────────────────────────────────────────────

function PkgCard({ pkg, expanded }: { pkg: FakePkg; expanded: boolean }) {
  const caps = [
    pkg.hasMesh && "Mesh",
    pkg.hasTexture && "Textures",
    pkg.hasHdr && "HDR",
    pkg.hasMotionCapture && "MoCap",
  ].filter(Boolean) as string[];

  const files = pkg.id === "pkg-1" ? PKG1_FILES : [];

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "2px",
        background: "var(--color-surface)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        {/* Chevron */}
        <div style={{ flexShrink: 0, color: "var(--color-ink)", opacity: expanded ? 1 : 0.35 }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s ease" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        {/* Metadata */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{pkg.name}</span>
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                padding: "0.1rem 0.4rem",
                borderRadius: "9999px",
                background: "#dcfce7",
                color: "#166534",
              }}
            >
              Ready
            </span>
          </div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
            {pkg.studioName} · {formatDate(pkg.captureDate)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            <span
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                padding: "0.15rem 0.4rem",
                borderRadius: "2px",
                background: "var(--color-accent)",
                color: "#fff",
                opacity: 0.85,
              }}
            >
              {SCAN_TYPE_LABEL[pkg.scanType] ?? pkg.scanType}
            </span>
            {caps.map((c) => (
              <span
                key={c}
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 500,
                  padding: "0.15rem 0.4rem",
                  borderRadius: "2px",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {c}
              </span>
            ))}
            {pkg.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "0.625rem",
                  padding: "0.15rem 0.4rem",
                  borderRadius: "2px",
                  background: "var(--color-surface)",
                  color: "var(--color-muted)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* File count */}
        <div style={{ flexShrink: 0, textAlign: "right", marginRight: "0.5rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-ink)" }}>
            {pkg.fileCount} files
          </div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>
            {formatBytes(pkg.totalSizeBytes)}
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.125rem", flexShrink: 0 }}>
          {[
            <svg key="eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
            <svg key="plus" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
            <svg key="shield" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
            <svg key="list" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="14" y2="12" /><line x1="4" y1="18" x2="10" y2="18" /><polyline points="16 16 19 19 22 16" /><line x1="19" y1="10" x2="19" y2="19" /></svg>,
          ].map((icon, i) => (
            <div key={i} style={{ padding: "0.375rem", color: "var(--color-ink)", opacity: 0.3, cursor: "default" }}>
              {icon}
            </div>
          ))}
        </div>
      </div>

      {/* Expanded file list */}
      {expanded && files.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "0.625rem 1.25rem",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.6875rem",
                fontWeight: 500,
                padding: "0.375rem 0.75rem",
                borderRadius: "2px",
                background: "var(--color-accent)",
                color: "#fff",
                border: "none",
                cursor: "default",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download all as .zip
            </button>
          </div>
          {files.map((file) => (
            <div
              key={file.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem 1.25rem 0.75rem 3.25rem",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--color-muted)", flexShrink: 0 }}
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-ink)" }}>{file.filename}</div>
                  <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>{formatBytes(file.sizeBytes)}</div>
                </div>
              </div>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.6875rem",
                  fontWeight: 500,
                  padding: "0.375rem 0.75rem",
                  border: "1px solid var(--color-border)",
                  borderRadius: "2px",
                  background: "var(--color-bg)",
                  color: "var(--color-ink)",
                  cursor: "default",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8 17 12 21 16 17" />
                  <line x1="12" y1="12" x2="12" y2="21" />
                  <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
                </svg>
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VaultView({ expandedId }: { expandedId: string | null }) {
  const totalSize = PACKAGES.reduce((s, p) => s + p.totalSizeBytes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-border)",
          padding: "1.25rem 3rem",
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>
            Your Vault
          </h1>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>
            {PACKAGES.length} scan packages
          </p>
        </div>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.625rem 1rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: "#fff",
            background: "var(--color-ink)",
            border: "none",
            borderRadius: "var(--radius)",
            cursor: "default",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Scan Package
        </button>
      </header>

      {/* Package list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "11rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {PACKAGES.map((pkg) => (
            <PkgCard key={pkg.id} pkg={pkg} expanded={expandedId === pkg.id} />
          ))}
        </div>
      </div>

      {/* Stats footer */}
      <footer
        style={{
          borderTop: "1px solid var(--color-border)",
          padding: "1rem 3rem",
          display: "flex",
          alignItems: "center",
          gap: "2rem",
          flexShrink: 0,
        }}
      >
        {[
          { label: "Total scans", value: String(PACKAGES.length) },
          { label: "Storage used", value: formatBytes(totalSize) },
          { label: "Active licences", value: "2" },
          { label: "Pending requests", value: "1" },
        ].map((s) => (
          <div key={s.label}>
            <p
              style={{
                fontSize: "0.6875rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--color-muted)",
                margin: 0,
              }}
            >
              {s.label}
            </p>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)", margin: "0.25rem 0 0" }}>
              {s.value}
            </p>
          </div>
        ))}
      </footer>
    </div>
  );
}

// ─── Licences view ────────────────────────────────────────────────────────────

function LicCard({
  lic,
  expanded,
  highlightDownload,
}: {
  lic: FakeLicence;
  expanded: boolean;
  highlightDownload?: boolean;
}) {
  const feeRef = lic.agreedFee ?? lic.proposedFee;
  const colour = STATUS_COLOUR[lic.status] ?? "#6b7280";
  const caps = [
    lic.packageHasMesh && "Mesh",
    lic.packageHasTexture && "Textures",
    lic.packageHasHdr && "HDR",
    lic.packageHasMotionCapture && "MoCap",
  ].filter(Boolean) as string[];

  const detailRows: [string, string][] = [
    ["Usage type", LICENCE_TYPE_LABEL[lic.licenceType] ?? lic.licenceType],
    ["Territory", lic.territory],
    ["Exclusivity", EXCLUSIVITY_LABEL[lic.exclusivity] ?? lic.exclusivity],
    ["AI processing", lic.permitAiTraining ? "Requested" : "Not requested"],
    ...(lic.approvedAt ? [["Approved", formatDate(lic.approvedAt)] as [string, string]] : []),
  ];

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        background: "var(--color-surface)",
      }}
    >
      <div style={{ padding: "1.25rem" }}>
        {/* Summary row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.125rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>
                {lic.projectName}
              </span>
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  padding: "0.1rem 0.5rem",
                  borderRadius: "9999px",
                  background: `${colour}18`,
                  color: colour,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {lic.status}
              </span>
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  padding: "0.1rem 0.5rem",
                  borderRadius: "9999px",
                  background: "var(--color-border)",
                  color: "var(--color-muted)",
                }}
              >
                {LICENCE_TYPE_LABEL[lic.licenceType] ?? lic.licenceType}
              </span>
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0.375rem" }}>
              Emma Richardson · {lic.productionCompany} · {lic.packageName}
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.375rem" }}>
              <span
                style={{
                  fontSize: "0.625rem",
                  fontWeight: 600,
                  padding: "0.15rem 0.4rem",
                  borderRadius: "2px",
                  background: "var(--color-accent)",
                  color: "#fff",
                  opacity: 0.85,
                }}
              >
                {SCAN_TYPE_LABEL[lic.packageScanType] ?? lic.packageScanType}
              </span>
              {caps.map((c) => (
                <span
                  key={c}
                  style={{
                    fontSize: "0.625rem",
                    fontWeight: 500,
                    padding: "0.15rem 0.4rem",
                    borderRadius: "2px",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                    background: "var(--color-surface)",
                  }}
                >
                  {c}
                </span>
              ))}
              {lic.packageTags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: "0.625rem",
                    padding: "0.15rem 0.4rem",
                    borderRadius: "2px",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-muted)",
                    background: "var(--color-surface)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>

            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>
              Licence period: {formatDate(lic.validFrom)} – {formatDate(lic.validTo)}
            </p>
            {feeRef && (
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0" }}>
                {lic.agreedFee ? "Agreed fee" : "Proposed fee"}: {fmtUSD(feeRef)}
              </p>
            )}
            {lic.downloadCount > 0 && (
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0" }}>
                {lic.downloadCount} download{lic.downloadCount !== 1 ? "s" : ""} · Last:{" "}
                {formatDate(lic.lastDownloadAt!)}
              </p>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.375rem 0.625rem",
                fontSize: "0.75rem",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                background: "var(--color-bg)",
                color: "var(--color-muted)",
                cursor: "default",
              }}
            >
              Details
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {lic.status === "PENDING" && (
              <button
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  background: "var(--color-bg)",
                  color: "var(--color-muted)",
                  cursor: "default",
                }}
              >
                Upload signed
              </button>
            )}

            {lic.status === "APPROVED" && (
              <button
                className={highlightDownload ? "demo-btn-pulse" : undefined}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "#fff",
                  background: "var(--color-accent)",
                  border: "none",
                  borderRadius: "var(--radius)",
                  cursor: "default",
                }}
              >
                Download
              </button>
            )}
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div
            style={{
              marginTop: "1rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              overflow: "hidden",
              fontSize: "0.75rem",
            }}
          >
            {detailRows.map(([key, val], i) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "0.5rem 0.75rem",
                  borderBottom: i < detailRows.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                <span style={{ color: "var(--color-muted)" }}>{key}</span>
                <span
                  style={{
                    fontWeight: 500,
                    color:
                      key === "AI processing" && lic.permitAiTraining ? "#b45309" : "var(--color-ink)",
                    textAlign: "right",
                  }}
                >
                  {val}
                </span>
              </div>
            ))}
            <div style={{ padding: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <p style={{ color: "var(--color-muted)", margin: "0 0 0.375rem" }}>Intended use</p>
              <p style={{ color: "var(--color-ink)", margin: 0, lineHeight: 1.6 }}>{lic.intendedUse}</p>
            </div>
            {feeRef && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--color-muted)" }}>
                    {lic.agreedFee ? "Agreed fee" : "Proposed fee"}
                  </span>
                  <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{fmtUSD(feeRef)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LicencesView({
  expandedId,
  highlightDownload,
}: {
  expandedId: string | null;
  highlightDownload?: boolean;
}) {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "11rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "var(--color-ink)",
              margin: 0,
            }}
          >
            My Licences
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>
            Track your licence requests and download approved scan packages.
          </p>
        </div>
        <button
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            color: "#fff",
            background: "var(--color-accent)",
            border: "none",
            borderRadius: "var(--radius)",
            cursor: "default",
            flexShrink: 0,
          }}
        >
          Browse Directory
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: "1.5rem",
        }}
      >
        {["All", "Pending", "Approved", "Denied"].map((tab) => (
          <div
            key={tab}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              color: tab === "All" ? "var(--color-ink)" : "var(--color-muted)",
              fontWeight: tab === "All" ? 600 : 400,
              position: "relative",
              cursor: "default",
            }}
          >
            {tab}
            {tab === "All" && (
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "2px",
                  background: "var(--color-accent)",
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {LICENCES.map((lic) => (
          <LicCard
            key={lic.id}
            lic={lic}
            expanded={expandedId === lic.id}
            highlightDownload={highlightDownload && expandedId === lic.id}
          />
        ))}
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
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(540px, calc(100% - 3rem))",
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
      {/* Progress dots */}
      <div
        style={{
          display: "flex",
          gap: "0.375rem",
          marginBottom: "0.875rem",
          justifyContent: "center",
        }}
      >
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

      {/* Text */}
      <h3
        style={{
          fontSize: "0.9375rem",
          fontWeight: 600,
          margin: "0 0 0.375rem",
          letterSpacing: "-0.01em",
        }}
      >
        {scene.headline}
      </h3>
      <p
        style={{
          fontSize: "0.8125rem",
          color: "rgba(255,255,255,0.6)",
          margin: "0 0 1rem",
          lineHeight: 1.65,
        }}
      >
        {scene.body}
      </p>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={onPrev}
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.375rem 0.875rem",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "4px",
            background: "transparent",
            color: "rgba(255,255,255,0.65)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Prev
        </button>

        <span
          style={{
            fontSize: "0.6875rem",
            color: "rgba(255,255,255,0.3)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {paused ? "Paused" : "Auto-playing"} · {sceneIndex + 1} / {total}
        </span>

        <button
          onClick={onNext}
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            padding: "0.375rem 0.875rem",
            border: "none",
            borderRadius: "4px",
            background: "#c0392b",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
          }}
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DemoClient() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const scene = SCENES[sceneIndex];

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      setSceneIndex((i) => (i + 1) % SCENES.length);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [sceneIndex, paused]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <style>{`
        @keyframes demo-ring {
          0%, 100% { box-shadow: 0 0 0 0 rgba(192,57,43,0.65); }
          50%       { box-shadow: 0 0 0 8px rgba(192,57,43,0); }
        }
        .demo-btn-pulse {
          animation: demo-ring 1.4s ease-in-out infinite;
        }
        @keyframes demo-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .demo-view-enter {
          animation: demo-fade-in 0.3s ease both;
        }
      `}</style>

      <DemoSidebar activeView={scene.view} />

      <main
        style={{
          flex: 1,
          overflow: "hidden",
          background: "var(--color-bg)",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          key={scene.id}
          className="demo-view-enter"
          style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          {scene.view === "vault" ? (
            <VaultView expandedId={scene.expandedPkg} />
          ) : (
            <LicencesView expandedId={scene.expandedLic} highlightDownload={scene.highlightDownload} />
          )}
        </div>

        <TourCard
          scene={scene}
          sceneIndex={sceneIndex}
          total={SCENES.length}
          paused={paused}
          onPrev={() => setSceneIndex((i) => (i - 1 + SCENES.length) % SCENES.length)}
          onNext={() => setSceneIndex((i) => (i + 1) % SCENES.length)}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        />
      </main>
    </div>
  );
}
