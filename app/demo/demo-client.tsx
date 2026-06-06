"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LicenceStatus = "APPROVED" | "PENDING";
type ViewType = "vault" | "licences" | "download" | "rep-roster" | "rep-detail" | "productions-list" | "add-cast" | "incoming-request" | "compliance-dashboard";
type RepTab = "vault" | "licences" | "permissions" | "revenue" | "deepscan";
type SidebarRole = "talent" | "licensee" | "rep" | "production";
type DemoMode = "talent" | "rep" | "production";
type NavId = "vault" | "licences" | "directory" | "settings" | "roster" | "productions" | "compliance";
type PermissionStatus = "allowed" | "approval_required" | "blocked";

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

interface RosterEntry {
  id: string;
  name: string;
  initials: string;
  packages: number;
  pendingLicences: number;
}

interface Permission {
  label: string;
  subtitle: string;
  status: PermissionStatus;
}

interface Scene {
  id: string;
  view: ViewType;
  expandedLic: string | null;
  sidebarRole: SidebarRole;
  licences?: FakeLicence[];
  repTab?: RepTab;
  headline: string;
  body: string;
}

// ─── Talent fake data ─────────────────────────────────────────────────────────

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

const BR3_PENDING: FakeLicence = {
  id: "lic-1",
  projectName: "Blade Runner 3",
  status: "PENDING",
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
  agreedFee: null,
  proposedFee: 8500000,
  intendedUse:
    "Digital double for principal photography sequences and VFX work on Blade Runner 3, including close-up facial replacement and full-body simulation.",
  approvedAt: null,
  downloadCount: 0,
  lastDownloadAt: null,
};

const BR3_APPROVED: FakeLicence = {
  ...BR3_PENDING,
  status: "APPROVED",
  agreedFee: 8500000,
  proposedFee: null,
  approvedAt: 1714521600,
  downloadCount: 3,
  lastDownloadAt: 1719792000,
};

const ALL_LICENCES: FakeLicence[] = [
  BR3_APPROVED,
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

// ─── Rep fake data ────────────────────────────────────────────────────────────

const ROSTER: RosterEntry[] = [
  { id: "4c6dd0ee-6c2f-4aac-b837-ebc03da698d9", name: "Channing Tatum", initials: "CT", packages: 3, pendingLicences: 1 },
  { id: "talent-sofia", name: "Sofia Esposito", initials: "SE", packages: 2, pendingLicences: 0 },
  { id: "talent-marcus", name: "Marcus Webb", initials: "MW", packages: 1, pendingLicences: 0 },
];

const CT_PACKAGES: FakePkg[] = [
  {
    id: "ct-pkg-1",
    name: "Gambit",
    studioName: "Framestore",
    captureDate: 1746057600,
    fileCount: 412,
    totalSizeBytes: 214748364800,
    scanType: "photogrammetry",
    hasMesh: true,
    hasTexture: true,
    hasHdr: false,
    hasMotionCapture: false,
    tags: ["full body", "neutral", "hi-res"],
  },
  {
    id: "ct-pkg-2",
    name: "Facial Performance — Weta Digital",
    studioName: "Weta Digital",
    captureDate: 1738368000,
    fileCount: 198,
    totalSizeBytes: 78643200000,
    scanType: "light_stage",
    hasMesh: true,
    hasTexture: true,
    hasHdr: true,
    hasMotionCapture: false,
    tags: ["blendshapes", "per-light EXR"],
  },
  {
    id: "ct-pkg-3",
    name: "Stunt Reference — ILM",
    studioName: "Industrial Light & Magic",
    captureDate: 1743465600,
    fileCount: 87,
    totalSizeBytes: 12884901888,
    scanType: "other",
    hasMesh: false,
    hasTexture: false,
    hasHdr: false,
    hasMotionCapture: true,
    tags: ["BVH", "action sequences"],
  },
];

const CT_LICENCES: FakeLicence[] = [
  {
    id: "ct-lic-1",
    projectName: "Calamity Hustle",
    status: "PENDING",
    licenceType: "film_double",
    productionCompany: "Warner Bros. Pictures",
    packageName: "Gambit",
    packageScanType: "photogrammetry",
    packageHasMesh: true,
    packageHasTexture: true,
    packageHasHdr: false,
    packageHasMotionCapture: false,
    packageTags: ["full body", "neutral"],
    validFrom: 1746835200,
    validTo: 1766707200,
    territory: "Worldwide",
    exclusivity: "non_exclusive",
    permitAiTraining: false,
    agreedFee: null,
    proposedFee: 20000000,
    intendedUse: "Digital double for principal photography and VFX work on Calamity Hustle.",
    approvedAt: null,
    downloadCount: 0,
    lastDownloadAt: null,
  },
  {
    id: "ct-lic-2",
    projectName: "G.I. Joe: Origins",
    status: "APPROVED",
    licenceType: "film_double",
    productionCompany: "Paramount Pictures",
    packageName: "Gambit",
    packageScanType: "photogrammetry",
    packageHasMesh: true,
    packageHasTexture: true,
    packageHasHdr: false,
    packageHasMotionCapture: false,
    packageTags: ["full body"],
    validFrom: 1741996800,
    validTo: 1764547200,
    territory: "Worldwide",
    exclusivity: "exclusive",
    permitAiTraining: false,
    agreedFee: 15000000,
    proposedFee: null,
    intendedUse: "Digital double for principal photography and action sequences in G.I. Joe: Origins.",
    approvedAt: 1742256000,
    downloadCount: 2,
    lastDownloadAt: 1745452800,
  },
];

const CT_PERMISSIONS: Permission[] = [
  { label: "Commercial Ads", subtitle: "TV, digital & out-of-home advertising", status: "approval_required" },
  { label: "Digital Stunt Double", subtitle: "De-aging, stunt replacement in film", status: "approval_required" },
  { label: "Video Game Character", subtitle: "In-engine game character or NPC", status: "approval_required" },
  { label: "AI Avatar", subtitle: "Real-time synthetic likeness use", status: "approval_required" },
  { label: "Training Datasets", subtitle: "AI model training data inclusion", status: "blocked" },
  { label: "Deepfake Protection", subtitle: "Monitoring / reference use only", status: "allowed" },
];

// ─── Tour scenes ──────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: "vault-overview",
    view: "vault",
    expandedLic: null,
    sidebarRole: "talent",
    headline: "Secure, encrypted vault",
    body: "Emma Richardson stores her scan packages — encrypted in the browser before upload. Not even the platform can access the files.",
  },
  {
    id: "licence-request",
    view: "licences",
    expandedLic: null,
    sidebarRole: "licensee",
    licences: [BR3_PENDING],
    headline: "Licence request submitted",
    body: "Warner Bros. requests access to the Framestore full-body scan for Blade Runner 3 — specifying usage type, territory, exclusivity, and proposed fee.",
  },
  {
    id: "licence-approved",
    view: "licences",
    expandedLic: "lic-1",
    sidebarRole: "talent",
    licences: ALL_LICENCES,
    headline: "Talent reviews and approves",
    body: "Emma reviews the project, territory, intended use, and agrees the $85,000 fee. She approves — the licence is now active.",
  },
  {
    id: "dual-custody-download",
    view: "download",
    expandedLic: null,
    sidebarRole: "licensee",
    headline: "Dual-custody download",
    body: "Both parties authenticate separately with 2FA. Neither the licensee, nor the platform, can release files without the talent's explicit approval.",
  },
];

const REP_SCENES: Scene[] = [
  {
    id: "rep-roster",
    view: "rep-roster",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Talent roster",
    body: "The rep manages Channing Tatum across all licence requests, approvals and downloads. One view for every active deal.",
  },
  {
    id: "rep-vault",
    view: "rep-detail",
    repTab: "vault",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Vault access",
    body: "Reps have direct access to all of a talent's scan packages — upload, manage metadata, and track storage on their behalf.",
  },
  {
    id: "rep-licences",
    view: "rep-detail",
    repTab: "licences",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Approve on behalf of talent",
    body: "Calamity Hustle is awaiting approval. The rep can approve or deny licence requests directly on Channing's behalf.",
  },
  {
    id: "rep-permissions",
    view: "rep-detail",
    repTab: "permissions",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Usage permissions",
    body: "AI avatars are blocked, commercial requires approval. Usage rules are set here to protect Channing's likeness across all future requests.",
  },
  {
    id: "rep-revenue",
    view: "rep-detail",
    repTab: "revenue",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Revenue tracking",
    body: "$350K across 2 active licences. The split is 65% to Channing, 20% to United Talent Agency, 15% to Image Vault.",
  },
];

// ─── Production fake data ─────────────────────────────────────────────────────

const PROD_PRODUCTIONS = [
  { id: "p1", name: "Untitled The Batman Sequel", company: "Warner Bros. Pictures", type: "Feature Film", year: 2027, status: "pre_production", licenceCount: 0, sagNumber: null as string | null, castTotal: 0, castConsented: 0 },
  { id: "p2", name: "Aquaman: Deep Dark", company: "Warner Bros. Pictures", type: "Feature Film", year: 2026, status: "production", licenceCount: 3, sagNumber: "SAG-2025-0082" as string | null, castTotal: 1, castConsented: 1 },
  { id: "p3", name: "Mortal Kombat 2", company: "Warner Bros. Pictures", type: "Feature Film", year: 2026, status: "post_production", licenceCount: 4, sagNumber: null as string | null, castTotal: 4, castConsented: 3 },
];

const BATMAN_CAST = [
  { id: "rp", name: "Robert Pattinson", character: "Bruce Wayne / The Batman", checked: false },
  { id: "jw", name: "Jeffrey Wright", character: "Lt. James Gordon", checked: false },
  { id: "as", name: "Andy Serkis", character: "Alfred", checked: true },
  { id: "cf", name: "Colin Farrell", character: "Oz / The Penguin", checked: false },
  { id: "jl", name: "Jayme Lawson", character: "Bella Real", checked: true },
];

const PROD_STATUS_COLOURS: Record<string, string> = {
  pre_production: "#b45309", production: "#166534", post_production: "#7c3aed",
  development: "#6b7280", released: "#0891b2", cancelled: "#374151",
};

const PROD_STATUS_LABELS: Record<string, string> = {
  pre_production: "Pre-Production", production: "In Production",
  post_production: "Post-Production", development: "Development",
};

const PROD_OBLIGATIONS = [
  { clauseRef: "39.B", title: "Performer consent to the digital replica", count: "9/11", pct: 82, barColor: "#c0392b", statusLabel: "⚠ 2 gaps", statusColor: "#c0392b" },
  { clauseRef: "39.E", title: "Biometric data isolation", count: "11/11", pct: 100, barColor: "#1a7f37", statusLabel: "✓ Met", statusColor: "#1a7f37" },
  { clauseRef: "39.H", title: "Replica security & custody", count: "10/11", pct: 91, barColor: "#c0392b", statusLabel: "⚠ 1 gap", statusColor: "#c0392b" },
  { clauseRef: "39.I", title: "Union-approved transfer", count: "—", pct: 100, barColor: "#1a7f37", statusLabel: "✓ Met", statusColor: "#1a7f37" },
  { clauseRef: "39.J", title: "Articulable business reason recorded", count: "9/11", pct: 82, barColor: "#2563eb", statusLabel: "⏳ 2 pending", statusColor: "#2563eb" },
  { clauseRef: "Scrub", title: "Replica deletion & scrub attestation", count: "—", pct: 0, barColor: "#2563eb", statusLabel: "⏳ 5 pending", statusColor: "#2563eb" },
];

const PROD_COMPLIANCE_PRODS = [
  {
    name: "Aquaman: Deep Dark", type: "film", licences: 3, score: 100,
    color: "#1a7f37", bg: "rgba(26,127,55,0.08)", border: "rgba(26,127,55,0.2)", statusLabel: "Compliant",
    castConsented: 1, castTotal: 1, castPct: 100,
    obligations: [
      { icon: "✓", color: "#1a7f37", label: "39.B Performer consent to the di..." },
      { icon: "✓", color: "#1a7f37", label: "39.E Biometric data isolation" },
      { icon: "✓", color: "#1a7f37", label: "39.H Replica security & custody" },
      { icon: "⏳", color: "#2563eb", label: "Scrub Replica deletion & scrub a..." },
    ],
  },
  {
    name: "Mortal Kombat 2", type: "film", licences: 4, score: 85,
    color: "#b45309", bg: "rgba(180,83,9,0.08)", border: "rgba(180,83,9,0.2)", statusLabel: "Partial",
    castConsented: 3, castTotal: 4, castPct: 75,
    obligations: [
      { icon: "✓", color: "#1a7f37", label: "39.B Performer consent to the di..." },
      { icon: "✓", color: "#1a7f37", label: "39.E Biometric data isolation" },
      { icon: "⚠", color: "#c0392b", label: "39.H Replica security & custody" },
      { icon: "⏳", color: "#2563eb", label: "Scrub Replica deletion & scrub a..." },
    ],
  },
  {
    name: "The Batman Sequel", type: "film", licences: 4, score: 68,
    color: "#c0392b", bg: "rgba(192,57,43,0.08)", border: "rgba(192,57,43,0.2)", statusLabel: "Gap",
    castConsented: 2, castTotal: 5, castPct: 40,
    obligations: [
      { icon: "⚠", color: "#c0392b", label: "39.B Performer consent to the di..." },
      { icon: "✓", color: "#1a7f37", label: "39.E Biometric data isolation" },
      { icon: "⚠", color: "#c0392b", label: "39.H Replica security & custody" },
      { icon: "⏳", color: "#2563eb", label: "Scrub Replica deletion & scrub a..." },
    ],
  },
];

const PROD_MODAL_OBLIGATIONS = [
  { clause: "39.B", title: "Performer consent to the digital replica", severity: "REQUIRED", status: "met" as const, eventLabel: "Consent granted", seq: 0, date: "31 May 2026", hash: "5c333f062995", meta: "use type: film double · territory: Worldwide" },
  { clause: "39.E", title: "Biometric data isolation", severity: "REQUIRED", status: "met" as const, eventLabel: "Biometric isolation attested", seq: 1, date: "31 May 2026", hash: "a968821d4005", meta: null },
  { clause: "39.H", title: "Replica security & custody", severity: "REQUIRED", status: "met" as const, eventLabel: "Security custody attested", seq: 2, date: "31 May 2026", hash: "616f027a13bd", meta: null },
  { clause: "39.J", title: "Articulable business reason recorded", severity: "RECOMMENDED", status: "met" as const, eventLabel: "Business reason recorded", seq: 3, date: "31 May 2026", hash: "d934fdaaa30e", meta: null },
  { clause: "Scrub", title: "Replica deletion & scrub attestation", severity: "REQUIRED", status: "pending" as const, eventLabel: null, seq: null, date: null, hash: null, meta: "Not yet required — obligation triggered on licence expiry" },
];

const PRODUCTION_SCENES: Scene[] = [
  {
    id: "prod-productions-list",
    view: "productions-list",
    expandedLic: null,
    sidebarRole: "production",
    headline: "Production selected",
    body: "Warner Bros. manages three active productions. The Batman Sequel is in pre-production with no cast yet. Aquaman: Deep Dark is in production with full consent. Mortal Kombat 2 is post-production with 3/4 cast consented.",
  },
  {
    id: "prod-add-cast",
    view: "add-cast",
    expandedLic: null,
    sidebarRole: "production",
    headline: "Talent selected and onboarded",
    body: "Import cast from the web in one click. Select the actors, add their emails — invites go out instantly, tied to the production's compliance regime and licence terms.",
  },
  {
    id: "prod-incoming-request",
    view: "incoming-request",
    expandedLic: null,
    sidebarRole: "talent",
    headline: "Talent receives cast licence request",
    body: "Emma Richardson receives the Batman Sequel cast invitation — Film / Digital Double, $350,000 proposed fee. She can attach an existing scan package or accept and get scanned as part of production.",
  },
  {
    id: "prod-compliance",
    view: "compliance-dashboard",
    expandedLic: null,
    sidebarRole: "production",
    headline: "Compliance view breakdown",
    body: "Aquaman: Deep Dark is 100% compliant. Mortal Kombat 2 is 85% — one security custody gap. The Batman Sequel sits at 68% with two required gaps and 40% cast onboarding. Not everything is green.",
  },
];

const AUTO_MS = 6000;

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

const PERM_COLOUR: Record<PermissionStatus, string> = {
  allowed: "#166534",
  approval_required: "#b45309",
  blocked: "#991b1b",
};


const PERM_LABEL: Record<PermissionStatus, string> = {
  allowed: "Allowed",
  approval_required: "Approval Required",
  blocked: "Blocked",
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const TALENT_NAV = [
  {
    id: "vault" as const,
    label: "Dashboard",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    id: "licences" as const,
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
    id: "settings" as const,
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const PRODUCTION_NAV = [
  {
    id: "directory" as NavId,
    label: "Directory",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "productions" as NavId,
    label: "Productions",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" /><polyline points="16 2 12 7 8 2" />
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
      </svg>
    ),
  },
  {
    id: "compliance" as NavId,
    label: "Compliance",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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

const LICENSEE_NAV = [
  {
    id: "directory" as const,
    label: "Directory",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "licences" as const,
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
    id: "settings" as const,
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const REP_NAV = [
  {
    id: "roster" as const,
    label: "Roster",
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
    id: "licences" as const,
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
    id: "settings" as const,
    label: "Settings",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

function DemoSidebar({
  role,
  activeNavId,
}: {
  role: SidebarRole;
  activeNavId: NavId;
}) {
  const nav = role === "talent" ? TALENT_NAV : role === "rep" ? REP_NAV : role === "production" ? PRODUCTION_NAV : LICENSEE_NAV;
  const user =
    role === "talent"
      ? { initials: "ER", name: "Emma Richardson", subtitle: "Talent" }
      : role === "rep"
      ? { initials: "AG", name: "Ari Gold", subtitle: "Representative" }
      : role === "production"
      ? { initials: "WB", name: "Warner Bros.", subtitle: "Production Co." }
      : { initials: "WB", name: "Warner Bros.", subtitle: "Licensee" };

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
          <a href="/demo" style={{ display: "block", padding: "0 1.5rem", marginBottom: "2.5rem", textDecoration: "none" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, letterSpacing: "0.05em", color: "#fff" }}>
              Image Vault
            </div>
            <div style={{ marginTop: "0.375rem", height: "1px", width: "1.5rem", background: "#c0392b" }} />
          </a>

          <nav style={{ padding: "0 0.75rem" }}>
            {nav.map((item) => {
              const active = item.id === activeNavId;
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
              {user.initials}
            </div>
            <div>
              <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "#fff" }}>{user.name}</div>
              <div style={{ fontSize: "0.625rem", color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}>
                {user.subtitle}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Vault view ───────────────────────────────────────────────────────────────

function PkgCard({ pkg }: { pkg: FakePkg }) {
  const caps = [
    pkg.hasMesh && "Mesh",
    pkg.hasTexture && "Textures",
    pkg.hasHdr && "HDR",
    pkg.hasMotionCapture && "MoCap",
  ].filter(Boolean) as string[];

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "2px",
        background: "var(--color-surface)",
      }}
    >
      <div style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{ flexShrink: 0, color: "var(--color-ink)", opacity: 0.35 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{pkg.name}</span>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "9999px", background: "#dcfce7", color: "#166534" }}>
              Ready
            </span>
          </div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
            {pkg.studioName} · {formatDate(pkg.captureDate)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.15rem 0.4rem", borderRadius: "2px", background: "var(--color-accent)", color: "#fff", opacity: 0.85 }}>
              {SCAN_TYPE_LABEL[pkg.scanType] ?? pkg.scanType}
            </span>
            {caps.map((c) => (
              <span key={c} style={{ fontSize: "0.625rem", fontWeight: 500, padding: "0.15rem 0.4rem", borderRadius: "2px", background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                {c}
              </span>
            ))}
            {pkg.tags.map((t) => (
              <span key={t} style={{ fontSize: "0.625rem", padding: "0.15rem 0.4rem", borderRadius: "2px", background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, textAlign: "right", marginRight: "0.5rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-ink)" }}>{pkg.fileCount} files</div>
          <div style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>{formatBytes(pkg.totalSizeBytes)}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.125rem", flexShrink: 0 }}>
          {[
            <svg key="eye" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>,
            <svg key="plus" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
            <svg key="shield" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
          ].map((icon, i) => (
            <div key={i} style={{ padding: "0.375rem", color: "var(--color-ink)", opacity: 0.3, cursor: "default" }}>
              {icon}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VaultView() {
  const totalSize = PACKAGES.reduce((s, p) => s + p.totalSizeBytes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)", padding: "1.25rem 3rem", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Your Vault</h1>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>{PACKAGES.length} scan packages</p>
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.625rem 1rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-ink)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Scan Package
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 3rem", paddingBottom: "13rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {PACKAGES.map((pkg) => <PkgCard key={pkg.id} pkg={pkg} />)}
        </div>
      </div>

      <footer style={{ borderTop: "1px solid var(--color-border)", padding: "1rem 3rem", display: "flex", alignItems: "center", gap: "2rem", flexShrink: 0 }}>
        {[
          { label: "Total scans", value: String(PACKAGES.length) },
          { label: "Storage used", value: formatBytes(totalSize) },
          { label: "Active licences", value: "2" },
          { label: "Pending requests", value: "1" },
        ].map((s) => (
          <div key={s.label}>
            <p style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", margin: 0 }}>{s.label}</p>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)", margin: "0.25rem 0 0" }}>{s.value}</p>
          </div>
        ))}
      </footer>
    </div>
  );
}

// ─── Licences view ────────────────────────────────────────────────────────────

function LicCard({ lic, expanded }: { lic: FakeLicence; expanded: boolean }) {
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
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)" }}>
      <div style={{ padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.125rem" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{lic.projectName}</span>
              <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.5rem", borderRadius: "9999px", background: `${colour}18`, color: colour, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {lic.status}
              </span>
              <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.5rem", borderRadius: "9999px", background: "var(--color-border)", color: "var(--color-muted)" }}>
                {LICENCE_TYPE_LABEL[lic.licenceType] ?? lic.licenceType}
              </span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0.375rem" }}>
              Emma Richardson · {lic.productionCompany} · {lic.packageName}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.375rem" }}>
              <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.15rem 0.4rem", borderRadius: "2px", background: "var(--color-accent)", color: "#fff", opacity: 0.85 }}>
                {SCAN_TYPE_LABEL[lic.packageScanType] ?? lic.packageScanType}
              </span>
              {caps.map((c) => (
                <span key={c} style={{ fontSize: "0.625rem", fontWeight: 500, padding: "0.15rem 0.4rem", borderRadius: "2px", border: "1px solid var(--color-border)", color: "var(--color-text)", background: "var(--color-surface)" }}>{c}</span>
              ))}
              {lic.packageTags.map((t) => (
                <span key={t} style={{ fontSize: "0.625rem", padding: "0.15rem 0.4rem", borderRadius: "2px", border: "1px solid var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }}>{t}</span>
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
                {lic.downloadCount} download{lic.downloadCount !== 1 ? "s" : ""} · Last: {formatDate(lic.lastDownloadAt!)}
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <button style={{ display: "flex", alignItems: "center", gap: "0.25rem", padding: "0.375rem 0.625rem", fontSize: "0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>
              Details
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {lic.status === "PENDING" && (
              <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>
                Upload signed
              </button>
            )}
            {lic.status === "APPROVED" && (
              <button style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
                Download
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div style={{ marginTop: "1rem", borderRadius: "var(--radius)", border: "1px solid var(--color-border)", overflow: "hidden", fontSize: "0.75rem" }}>
            {detailRows.map(([key, val], i) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.5rem 0.75rem", borderBottom: i < detailRows.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                <span style={{ color: "var(--color-muted)" }}>{key}</span>
                <span style={{ fontWeight: 500, color: "var(--color-ink)", textAlign: "right" }}>{val}</span>
              </div>
            ))}
            <div style={{ padding: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <p style={{ color: "var(--color-muted)", margin: "0 0 0.375rem" }}>Intended use</p>
              <p style={{ color: "var(--color-ink)", margin: 0, lineHeight: 1.6 }}>{lic.intendedUse}</p>
            </div>
            {feeRef && (
              <div style={{ padding: "0.75rem", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-muted)" }}>{lic.agreedFee ? "Agreed fee" : "Proposed fee"}</span>
                <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{fmtUSD(feeRef)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LicencesView({ licences, expandedId }: { licences: FakeLicence[]; expandedId: string | null }) {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>
            My Licences
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>
            Track your licence requests and download approved scan packages.
          </p>
        </div>
        <button style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "var(--radius)", cursor: "default", flexShrink: 0 }}>
          Browse Directory
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--color-border)", marginBottom: "1.5rem" }}>
        {["All", "Pending", "Approved", "Denied"].map((tab) => (
          <div key={tab} style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", color: tab === "All" ? "var(--color-ink)" : "var(--color-muted)", fontWeight: tab === "All" ? 600 : 400, position: "relative", cursor: "default" }}>
            {tab}
            {tab === "All" && <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: "var(--color-accent)" }} />}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {licences.map((lic) => (
          <LicCard key={lic.id} lic={lic} expanded={expandedId === lic.id} />
        ))}
      </div>
    </div>
  );
}

// ─── Dual-custody download view ───────────────────────────────────────────────

function DualCustodyDownloadView() {
  const steps = ["Verify identity", "Talent approval", "Download"];
  const currentStep = 2;

  return (
    <div style={{ padding: "2rem 3rem", overflowY: "auto", height: "100%", paddingBottom: "13rem", maxWidth: "42rem" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--color-muted)", cursor: "default" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        My Licences
      </div>

      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.5rem" }}>
        Dual-Custody Download
      </h1>
      <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: "0 0 2rem" }}>
        Both you and the talent must complete identity verification before files can be downloaded.
      </p>

      <div style={{ marginBottom: "2rem", display: "flex", alignItems: "flex-start", gap: "0" }}>
        {steps.map((label, i) => (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 600,
                background: i <= currentStep ? "var(--color-accent)" : "var(--color-border)",
                color: i <= currentStep ? "#fff" : "var(--color-muted)",
              }}>
                {i < currentStep ? "✓" : i + 1}
              </div>
              <span style={{ marginTop: "0.3rem", fontSize: "0.6rem", textAlign: "center", width: "3.5rem", lineHeight: 1.3, color: i === currentStep ? "var(--color-ink)" : "var(--color-muted)", fontWeight: i === currentStep ? 500 : 400 }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: "2.5rem", height: "1px", background: i < currentStep ? "var(--color-accent)" : "var(--color-border)", marginBottom: "1.25rem", flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ marginBottom: "1.25rem", borderRadius: "var(--radius)", padding: "0.75rem 1rem", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: "0.875rem" }}>
        Both verifications complete — download links are valid for 48 hours.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Licensee", name: "Warner Bros. Pictures", icon: "WB" },
          { label: "Talent", name: "Emma Richardson", icon: "ER" },
        ].map((party) => (
          <div key={party.label} style={{ borderRadius: "var(--radius)", border: "1px solid #bbf7d0", padding: "0.875rem 1rem", background: "#f0fdf4" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
              <div style={{ width: "1.5rem", height: "1.5rem", borderRadius: "50%", background: "#166534", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.45rem", fontWeight: 700, color: "#fff", letterSpacing: "0.05em", flexShrink: 0 }}>
                {party.icon}
              </div>
              <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#166534", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {party.label}
              </span>
            </div>
            <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "#14532d", margin: "0 0 0.25rem" }}>{party.name}</p>
            <p style={{ fontSize: "0.6875rem", color: "#166534", margin: 0, display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              2FA verified
            </p>
          </div>
        ))}
      </div>

      <button style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: "0.5rem", borderRadius: "var(--radius)", padding: "0.75rem", fontSize: "0.875rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", cursor: "default", marginBottom: "0.75rem" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download all {PKG1_FILES.length} files as .zip
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {PKG1_FILES.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "var(--radius)", border: "1px solid var(--color-border)", padding: "0.75rem 1rem", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-ink)", cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)", flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8125rem" }}>{f.filename}</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-accent)", flexShrink: 0, marginLeft: "0.75rem" }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rep: Roster view ─────────────────────────────────────────────────────────

function RosterView() {
  const ctSizeGB = CT_PACKAGES.reduce((s, p) => s + p.totalSizeBytes, 0) / (1024 ** 3);

  return (
    <div style={{ overflowY: "auto", height: "100%", paddingBottom: "13rem" }}>
      {/* Page header */}
      <div style={{ padding: "2rem 2.5rem 0" }}>
        <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.375rem" }}>
          Representative
        </p>
        <h1 style={{ fontSize: "1.375rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.25rem" }}>My Roster</h1>
        <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 1.5rem" }}>1 talent</p>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
          {[
            { label: "Active Licences", value: "1", sub: null },
            { label: "Revenue This Quarter", value: "$0", sub: "$150,000 lifetime", accent: true },
            { label: "Pending Requests", value: "1", sub: "awaiting approval" },
            { label: "Ready Scans", value: "3", sub: null },
          ].map((c) => (
            <div key={c.label} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.875rem 1rem", background: "var(--color-surface)" }}>
              <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>{c.label}</p>
              <p style={{ fontSize: "1.25rem", fontWeight: 700, color: c.accent ? "var(--color-accent)" : "var(--color-ink)", margin: "0 0 0.125rem" }}>{c.value}</p>
              {c.sub && <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* Alert */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.625rem 0.875rem", border: "1px solid rgba(192,57,43,0.3)", borderRadius: "var(--radius)", background: "rgba(192,57,43,0.04)", marginBottom: "1.25rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c0392b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-ink)", margin: 0 }}>
            <strong>1 licence request</strong> awaiting approval across your roster.
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: "1.25rem" }}>
          {["Roster", "Revenue"].map((t) => (
            <div key={t} style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: t === "Roster" ? 600 : 400, color: t === "Roster" ? "var(--color-ink)" : "var(--color-muted)", position: "relative", cursor: "default" }}>
              {t}
              {t === "Roster" && <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: "var(--color-accent)" }} />}
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "1.25rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)" }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div style={{ width: "100%", padding: "0.5rem 0.75rem 0.5rem 2.25rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
            Search by name or email...
          </div>
        </div>
      </div>

      {/* Talent grid */}
      <div style={{ padding: "0 2.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem" }}>
        {ROSTER.map((talent, i) => (
          <div key={talent.id} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", overflow: "hidden" }}>
            {/* Photo area */}
            <div style={{ position: "relative", aspectRatio: "3/4", background: "linear-gradient(160deg, #e5e7eb 0%, #d1d5db 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {i === 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/demo-ct.jpg" alt="Channing Tatum" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", display: "block" }} />
              ) : (
                <span style={{ fontSize: "2.5rem", fontWeight: 700, color: "rgba(0,0,0,0.12)", letterSpacing: "-0.04em", userSelect: "none" }}>
                  {talent.initials}
                </span>
              )}
              {/* Pending badge */}
              {talent.pendingLicences > 0 && (
                <span style={{ position: "absolute", top: "0.5rem", right: "0.5rem", fontSize: "0.6rem", fontWeight: 700, padding: "0.2rem 0.4rem", borderRadius: "9999px", background: "#c0392b", color: "#fff", letterSpacing: "0.04em" }}>
                  {talent.pendingLicences} pending
                </span>
              )}
              {/* Verified badge */}
              {i === 0 && (
                <span style={{ position: "absolute", bottom: "0.5rem", left: "0.5rem", fontSize: "0.55rem", fontWeight: 700, padding: "0.2rem 0.5rem", borderRadius: "2px", background: "#166534", color: "#fff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Verified
                </span>
              )}
            </div>
            {/* Info */}
            <div style={{ padding: "0.75rem" }}>
              <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-ink)", margin: "0 0 0.125rem" }}>{talent.name}</p>
              <p style={{ fontSize: "0.6rem", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>
                {talent.packages} package{talent.packages !== 1 ? "s" : ""}{i === 0 ? ` · ${ctSizeGB.toFixed(1)} GB` : ""}
              </p>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                <button style={{ flex: 1, padding: "0.3rem 0", fontSize: "0.6875rem", fontWeight: 500, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default" }}>
                  View Profile
                </button>
                <button style={{ flex: 1, padding: "0.3rem 0", fontSize: "0.6875rem", fontWeight: 500, border: "none", borderRadius: "var(--radius)", background: "var(--color-ink)", color: "#fff", cursor: "default" }}>
                  Manage
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rep: detail tab components ───────────────────────────────────────────────

function RepVaultTab() {
  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {CT_PACKAGES.map((pkg) => <PkgCard key={pkg.id} pkg={pkg} />)}
      </div>
    </div>
  );
}

function RepLicCard({ lic }: { lic: FakeLicence }) {
  const colour = STATUS_COLOUR[lic.status] ?? "#6b7280";
  const feeRef = lic.agreedFee ?? lic.proposedFee;

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", padding: "1rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.125rem" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{lic.projectName}</span>
            <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.5rem", borderRadius: "9999px", background: `${colour}18`, color: colour, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {lic.status}
            </span>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0.25rem" }}>
            {lic.productionCompany} · {lic.packageName}
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>
            {formatDate(lic.validFrom)} – {formatDate(lic.validTo)}
            {feeRef != null && <> · {fmtUSD(feeRef)}</>}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, alignItems: "center" }}>
          {lic.status === "PENDING" && (
            <>
              <button style={{ padding: "0.375rem 0.875rem", fontSize: "0.75rem", fontWeight: 500, border: "1px solid #bbf7d0", borderRadius: "var(--radius)", background: "#f0fdf4", color: "#166534", cursor: "default" }}>
                Approve
              </button>
              <button style={{ padding: "0.375rem 0.875rem", fontSize: "0.75rem", fontWeight: 500, border: "1px solid #fecaca", borderRadius: "var(--radius)", background: "#fef2f2", color: "#991b1b", cursor: "default" }}>
                Deny
              </button>
            </>
          )}
          {lic.status === "APPROVED" && (
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#166534", display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Active
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RepLicencesTab() {
  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {CT_LICENCES.map((lic) => (
          <RepLicCard key={lic.id} lic={lic} />
        ))}
      </div>
    </div>
  );
}

function RepPermissionsTab() {
  const TOGGLE_OPTIONS: { value: PermissionStatus; label: string }[] = [
    { value: "allowed", label: "Allowed" },
    { value: "approval_required", label: "Approval Required" },
    { value: "blocked", label: "Blocked" },
  ];

  const activeStyle = (opt: PermissionStatus, current: PermissionStatus) => {
    if (opt !== current) {
      return { background: "transparent", color: "var(--color-muted)", border: "1px solid var(--color-border)" };
    }
    if (opt === "allowed") return { background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", fontWeight: 600 };
    if (opt === "approval_required") return { background: "rgba(192,57,43,0.1)", color: "#c0392b", border: "1px solid rgba(192,57,43,0.3)", fontWeight: 600 };
    return { background: "#1a1a1a", color: "#fff", border: "1px solid #1a1a1a", fontWeight: 600 };
  };

  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      <p style={{ fontSize: "0.8125rem", color: "var(--color-muted)", margin: "0 0 1.25rem", lineHeight: 1.6 }}>
        Control which licence types can be used for this talent. Reps can set defaults on their behalf — talent can always override in their own settings.
      </p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {CT_PERMISSIONS.map((p, i) => (
          <div
            key={p.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "0.875rem 1rem",
              borderBottom: i < CT_PERMISSIONS.length - 1 ? "1px solid var(--color-border)" : "none",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.2rem" }}>{p.label}</p>
              <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 0.4rem" }}>{p.subtitle}</p>
              <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.05em" }}>
                <span style={{ color: PERM_COLOUR[p.status] }}>● </span>
                <span style={{ color: "var(--color-muted)" }}>{PERM_LABEL[p.status]}</span>
              </span>
            </div>
            <div style={{ display: "flex", borderRadius: "var(--radius)", overflow: "hidden", flexShrink: 0, border: "1px solid var(--color-border)" }}>
              {TOGGLE_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  style={{
                    padding: "0.3rem 0.625rem",
                    fontSize: "0.6875rem",
                    cursor: "default",
                    whiteSpace: "nowrap",
                    ...activeStyle(opt.value, p.status),
                    border: "none",
                    borderRight: opt.value !== "blocked" ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtUSDk(cents: number): string {
  const k = cents / 100 / 1000;
  return `$${k % 1 === 0 ? k.toFixed(1) : k.toFixed(1)}K`;
}

function RepRevenueTab() {
  const approvedLicences = CT_LICENCES.filter((l) => l.status === "APPROVED");
  const gross = approvedLicences.reduce((s, l) => s + (l.agreedFee ?? 0), 0);
  const talentCut = Math.round(gross * 0.80);
  const agencyCut = Math.round(gross * 0.10);
  const platformCut = Math.round(gross * 0.10);

  const statCards = [
    { label: "Gross Licence Value", pct: null, value: gross, sub: `${approvedLicences.length} approved licence${approvedLicences.length !== 1 ? "s" : ""}`, accent: true },
    { label: "Talent Share", pct: "80%", value: talentCut, sub: null, accent: false },
    { label: "Agency Commission", pct: "10%", value: agencyCut, sub: null, accent: false },
    { label: "Platform Fee", pct: "10%", value: platformCut, sub: null, accent: false },
  ];

  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        {statCards.map((c) => (
          <div key={c.label} style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.875rem 1rem", background: "var(--color-surface)" }}>
            <p style={{ fontSize: "0.6rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>
              {c.label}{c.pct ? ` (${c.pct})` : ""}
            </p>
            <p style={{ fontSize: "1.25rem", fontWeight: 700, color: c.accent ? "var(--color-accent)" : "var(--color-ink)", margin: "0 0 0.125rem" }}>
              {fmtUSD(c.value)}
            </p>
            {c.sub && <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Licence history */}
      <p style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
        Licence History
      </p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {/* Table header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "1rem", padding: "0.5rem 1rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          {["Project", "Type", "Fee", "Status"].map((h) => (
            <p key={h} style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>{h}</p>
          ))}
        </div>

        {/* Rows — first row (Calamity Hustle) shown expanded */}
        {CT_LICENCES.map((lic, i) => {
          const fee = lic.agreedFee ?? lic.proposedFee ?? 0;
          const colour = STATUS_COLOUR[lic.status] ?? "#6b7280";
          const expanded = i === 0;
          const platform = Math.round(fee * 0.10);
          const agency = Math.round(fee * 0.10);
          const talent = fee - platform - agency;

          return (
            <div key={lic.id} style={{ borderBottom: i < CT_LICENCES.length - 1 ? "1px solid var(--color-border)" : "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "1rem", alignItems: "center", padding: "0.875rem 1rem", background: "var(--color-surface)", cursor: "default" }}>
                <div>
                  <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: "0 0 0.125rem" }}>{lic.projectName}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>{lic.productionCompany.replace(" Pictures", "").replace(" Entertainment", "")}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.875rem", color: "var(--color-ink)", margin: "0 0 0.125rem" }}>{LICENCE_TYPE_LABEL[lic.licenceType] ?? lic.licenceType}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>{lic.territory}</p>
                </div>
                <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)", margin: 0, whiteSpace: "nowrap" }}>{fmtUSDk(fee)}</p>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.15rem 0.5rem", borderRadius: "9999px", background: `${colour}18`, color: colour, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {lic.status}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)", transform: expanded ? "rotate(180deg)" : "none" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {expanded && (
                <div style={{ padding: "0 1rem 1rem", background: "var(--color-bg)", borderTop: "1px solid var(--color-border)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 2rem", padding: "0.875rem 0", borderBottom: "1px solid var(--color-border)", marginBottom: "0.75rem" }}>
                    {[
                      { label: "Licensee", value: "lukefieldsend+licensee@googlemail.com" },
                      { label: "Valid period", value: `${formatDate(lic.validFrom)} – ${formatDate(lic.validTo)}` },
                      { label: "Approved", value: lic.approvedAt ? formatDate(lic.approvedAt) : "—" },
                      { label: "Downloads", value: String(lic.downloadCount) },
                    ].map((row) => (
                      <div key={row.label}>
                        <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: "0 0 0.125rem" }}>{row.label}</p>
                        <p style={{ fontSize: "0.8125rem", color: "var(--color-ink)", margin: 0 }}>{row.value}</p>
                      </div>
                    ))}
                  </div>
                  {[
                    { label: `Proposed fee`, value: fmtUSDk(fee), muted: false, accent: false },
                    { label: `Platform (10%)`, value: `~${fmtUSDk(platform)}`, muted: true, accent: false },
                    { label: `Agency (10%)`, value: `~${fmtUSDk(agency)}`, muted: true, accent: false },
                    { label: `Talent earnings`, value: fmtUSDk(talent), muted: false, accent: true },
                  ].map((row) => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
                      <span style={{ fontSize: "0.8125rem", color: row.accent ? "var(--color-accent)" : row.muted ? "var(--color-muted)" : "var(--color-ink)", fontWeight: row.accent ? 600 : 400 }}>{row.label}</span>
                      <span style={{ fontSize: "0.8125rem", color: row.accent ? "var(--color-accent)" : row.muted ? "var(--color-muted)" : "var(--color-ink)", fontWeight: row.accent ? 600 : 500 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Rep: detail layout ───────────────────────────────────────────────────────

function RepDetailLayout({ tab }: { tab: RepTab }) {
  const TABS: { id: RepTab; label: string }[] = [
    { id: "vault", label: "Vault" },
    { id: "licences", label: "Licences" },
    { id: "permissions", label: "Permissions" },
    { id: "revenue", label: "Revenue" },
    { id: "deepscan", label: "DeepScan" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Acting-as banner */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.4rem 2rem",
        background: "rgba(192,57,43,0.04)",
        borderBottom: "1px solid rgba(192,57,43,0.1)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.6875rem", color: "#c0392b" }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          </svg>
          Acting on behalf of <strong style={{ marginLeft: "0.2rem" }}>Channing Tatum</strong>
        </div>
        <span style={{ fontSize: "0.6875rem", color: "#c0392b", cursor: "default" }}>Back to roster</span>
      </div>

      {/* Talent header + tab bar */}
      <div style={{ padding: "1.25rem 2rem 0", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ width: "2.75rem", height: "2.75rem", borderRadius: "50%", background: "#2a2a2a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
            CT
          </div>
          <div>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>
              Channing Tatum
            </h1>
            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.1rem 0 0.1rem" }}>
              channing@gmail.com
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>
              3 scan packages
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0" }}>
          {TABS.map((t) => (
            <div key={t.id} style={{
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "var(--color-ink)" : "var(--color-muted)",
              position: "relative",
              cursor: "default",
            }}>
              {t.label}
              {tab === t.id && (
                <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: "var(--color-accent)" }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "vault" && <RepVaultTab />}
        {tab === "licences" && <RepLicencesTab />}
        {tab === "permissions" && <RepPermissionsTab />}
        {tab === "revenue" && <RepRevenueTab />}
        {tab === "deepscan" && (
          <div style={{ padding: "2rem", color: "var(--color-muted)", fontSize: "0.875rem" }}>DeepScan coming soon.</div>
        )}
      </div>
    </div>
  );
}

// ─── Production: Productions List ────────────────────────────────────────────

function ProductionsListView() {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ maxWidth: "48rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2.5rem" }}>
          <div>
            <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-accent)", margin: "0 0 0.25rem" }}>Your Productions</p>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.25rem" }}>Productions</h1>
            <p style={{ fontSize: "0.9375rem", color: "var(--color-muted)", margin: 0 }}>Manage cast, licences, and compliance for each production.</p>
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "4px", cursor: "default", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Production
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {PROD_PRODUCTIONS.map((p) => {
            const sc = p.status ? PROD_STATUS_COLOURS[p.status] : null;
            const sl = p.status ? PROD_STATUS_LABELS[p.status] : null;
            const castPct = p.castTotal > 0 ? Math.round((p.castConsented / p.castTotal) * 100) : 0;
            const castColour = castPct === 100 ? "#166534" : "#b45309";
            return (
              <div key={p.id} style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {p.type && <span style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)" }}>{p.type}</span>}
                      {p.type && p.year && <span style={{ fontSize: "0.625rem", color: "var(--color-border)" }}>·</span>}
                      {p.year && <span style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)" }}>{p.year}</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
                      {sc && sl && (
                        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                          <span style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: sc, display: "inline-block" }} />
                          <span style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: sc }}>{sl}</span>
                        </span>
                      )}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1.5rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em", color: "var(--color-ink)", margin: "0 0 0.375rem" }}>{p.name}</h2>
                      {p.company && <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: 0 }}>{p.company}</p>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <p style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--color-ink)", margin: "0 0 0.125rem", lineHeight: 1 }}>{p.licenceCount}</p>
                      <p style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>Licences</p>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "0.625rem 1.5rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", background: "var(--color-bg)" }}>
                  <span style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>
                    {p.sagNumber ? `SAG-AFTRA · ${p.sagNumber}` : "No SAG-AFTRA project number"}
                  </span>
                  {p.castTotal > 0 ? (
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.6875rem", color: "var(--color-muted)" }}>{p.castConsented}/{p.castTotal} cast consented</span>
                      <span style={{ display: "inline-flex", width: "5rem", height: "0.25rem", borderRadius: "9999px", overflow: "hidden", background: "var(--color-border)" }}>
                        <span style={{ height: "100%", borderRadius: "9999px", width: `${castPct}%`, background: castColour }} />
                      </span>
                      <span style={{ fontSize: "0.625rem", fontWeight: 700, color: castColour }}>{castPct}%</span>
                    </span>
                  ) : (
                    <span style={{ marginLeft: "auto", fontSize: "0.625rem", fontWeight: 700, padding: "0.2rem 0.5rem", borderRadius: "4px", background: "rgba(180,83,9,0.08)", color: "#b45309" }}>No cast added yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Production: Add Cast ─────────────────────────────────────────────────────

function AddCastView() {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ maxWidth: "40rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--color-muted)", marginBottom: "1.25rem", cursor: "default" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Productions
        </div>
        <div style={{ marginBottom: "1.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.375rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>Untitled The Batman Sequel</h1>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "0.15rem 0.5rem", borderRadius: "9999px", background: "rgba(192,57,43,0.1)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>film</span>
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: 0 }}>Warner Bros · 2027 · Dir. Matt Reeves</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>
            Cast&nbsp;&nbsp;<span style={{ fontWeight: 400 }}>0 Members</span>
          </p>
          <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.875rem", fontSize: "0.8125rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "4px", cursor: "default" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Cast
          </button>
        </div>

        <div style={{ border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden", marginBottom: "1.5rem" }}>
          <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>Add Cast Members</p>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {["Manual Entry", "Web Import", "CSV Upload"].map((tab) => (
                <button key={tab} style={{ padding: "0.3rem 0.75rem", fontSize: "0.8125rem", fontWeight: 500, borderRadius: "4px", cursor: "default", ...(tab === "Web Import" ? { background: "var(--color-accent)", color: "#fff", border: "none" } : { background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }) }}>
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {BATMAN_CAST.map((actor, i) => (
            <div key={actor.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1.25rem", borderBottom: i < BATMAN_CAST.length - 1 ? "1px solid var(--color-border)" : "none", background: actor.checked ? "rgba(192,57,43,0.025)" : "var(--color-bg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                <div style={{ width: "1rem", height: "1rem", borderRadius: "3px", border: `2px solid ${actor.checked ? "var(--color-accent)" : "var(--color-border)"}`, background: actor.checked ? "var(--color-accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {actor.checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{actor.name}</span>
                <span style={{ fontSize: "0.875rem", color: "var(--color-muted)" }}>as {actor.character}</span>
              </div>
              {actor.checked && (
                <div style={{ flexShrink: 0, padding: "0.375rem 0.625rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-bg)", fontSize: "0.8125rem", color: "var(--color-muted)", width: "11rem" }}>
                  Email address
                </div>
              )}
            </div>
          ))}
        </div>

        <div>
          <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.25rem" }}>Licence Terms</p>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 1rem", lineHeight: 1.6 }}>These terms apply to all members in this batch. Terms copy forward from your previous entry.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.375rem" }}>Intended Use *</label>
              <div style={{ padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-muted)" }}>e.g. Digital double for VFX sequences</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {["Valid From *", "Valid To *"].map((l) => (
                <div key={l}>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.375rem" }}>{l}</label>
                  <div style={{ padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-muted)" }}>dd/mm/yyyy</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {[["Licence Type", "Film / Double"], ["Exclusivity", "Non-exclusive"]].map(([l, v]) => (
                <div key={l}>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.375rem" }}>{l}</label>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-ink)" }}>
                    <span>{v}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.375rem" }}>Territory</label>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-muted)" }}>
                  <span>Select territory...</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.375rem" }}>Proposed Fee ($)</label>
                <div style={{ padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.875rem", color: "var(--color-muted)" }}>0</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Production: Incoming Request ─────────────────────────────────────────────

function IncomingRequestView() {
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ maxWidth: "48rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.375rem" }}>Incoming Requests</h1>
        <p style={{ fontSize: "0.9375rem", color: "var(--color-muted)", margin: "0 0 2rem" }}>Review and approve or deny licence requests from production companies.</p>

        <div style={{ border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden", background: "var(--color-surface)" }}>
          <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.75rem", borderRadius: "9999px", background: "var(--color-accent)", color: "#fff", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", marginBottom: "0.875rem" }}>
                  CAST INVITATION
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
                  <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--color-ink)", margin: 0 }}>Untitled The Batman Sequel</h2>
                  <span style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>Film / Digital Double</span>
                </div>
                <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: "0 0 0.375rem" }}>Warner Bros. Pictures · Worldwide</p>
                <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-accent)", margin: 0 }}>Proposed fee: $350,000</p>
              </div>
              <button style={{ display: "flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.75rem", fontSize: "0.875rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default", flexShrink: 0 }}>
                Details
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
          </div>

          <div style={{ padding: "1.25rem 1.5rem", background: "var(--color-bg)" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--color-muted)", margin: "0 0 1rem", lineHeight: 1.6 }}>
              Attach an existing scan package, or accept and get scanned as part of the production.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.625rem 0.875rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-surface)", fontSize: "0.9375rem", color: "var(--color-muted)" }}>
                <span>— select a package —</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <button style={{ padding: "0.625rem 1rem", fontSize: "0.875rem", fontWeight: 500, borderRadius: "4px", border: "none", background: "rgba(192,57,43,0.4)", color: "#fff", cursor: "default" }}>
                Attach Package
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
              <button style={{ padding: "0.625rem 1.25rem", fontSize: "0.9375rem", fontWeight: 500, color: "#fff", background: "var(--color-accent)", border: "none", borderRadius: "4px", cursor: "default" }}>
                Accept — get scanned later
              </button>
              <button style={{ fontSize: "0.9375rem", color: "var(--color-muted)", background: "none", border: "none", cursor: "default" }}>
                Decline invitation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Production: Compliance Dashboard ────────────────────────────────────────

function ComplianceDashboardView() {
  const overallScore = 82;
  const overallColor = "#b45309"; // partial — has gaps
  const circ52 = 2 * Math.PI * 52;
  const circ22 = 2 * Math.PI * 22;
  const overallOffset = circ52 * (1 - overallScore / 100);

  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ maxWidth: "56rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: "0 0 0.375rem" }}>Compliance Control Centre</h1>
            <p style={{ fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>
              SAG-AFTRA Article 39&nbsp;&nbsp;·&nbsp;&nbsp;2026 TV/Theatrical AI&nbsp;&nbsp;·&nbsp;&nbsp;
              <span style={{ color: "var(--color-accent)" }}>RUMBLE POST +</span>
            </p>
          </div>
          <button style={{ padding: "0.5rem 1rem", fontSize: "0.8125rem", fontWeight: 500, background: "var(--color-accent)", color: "#fff", border: "none", borderRadius: "4px", cursor: "default", flexShrink: 0 }}>
            Generate Certificate
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", padding: "1.25rem 1.5rem", border: "1px solid var(--color-border)", borderRadius: "8px", background: "var(--color-surface)", marginBottom: "1.5rem" }}>
          <div style={{ flexShrink: 0 }}>
            <svg width="96" height="96" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="52" fill="none" stroke="var(--color-border)" strokeWidth="8" />
              <circle cx="64" cy="64" r="52" fill="none" stroke={overallColor} strokeWidth="8" strokeDasharray={circ52} strokeDashoffset={overallOffset} strokeLinecap="round" transform="rotate(-90 64 64)" />
              <text x="64" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--color-text)">{overallScore}%</text>
              <text x="64" y="78" textAnchor="middle" fontSize="10" fill={overallColor} style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Partial</text>
            </svg>
          </div>
          <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
            {[["11", "Licences"], ["3/3", "Productions"], ["2", "Required Gaps"], ["0", "Active Strikes"], ["1", "Pending Transfers"]].map(([v, l]) => {
              const warn = (l === "Required Gaps" || l === "Pending Transfers") && v !== "0";
              return (
              <div key={l} style={{ border: "1px solid var(--color-border)", borderRadius: "4px", padding: "0.75rem 1rem", background: "var(--color-bg)", minWidth: "5rem" }}>
                <p style={{ fontSize: "1.5rem", fontWeight: 700, color: warn ? "var(--color-accent)" : "var(--color-ink)", margin: "0 0 0.125rem", lineHeight: 1 }}>{v}</p>
                <p style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", margin: 0 }}>{l}</p>
              </div>
            );})}
          </div>
        </div>

        {/* Obligation progress */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "8px", overflow: "hidden", background: "var(--color-surface)", marginBottom: "1.5rem" }}>
          <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--color-border)", margin: 0 }}>Obligation Progress</p>
          <div style={{ padding: "0 1.25rem" }}>
            {PROD_OBLIGATIONS.map((ob) => (
              <div key={ob.clauseRef} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "0.625rem 0", borderBottom: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: "0.75rem", fontFamily: "monospace", width: "3rem", flexShrink: 0, color: "var(--color-muted)" }}>{ob.clauseRef}</span>
                <span style={{ fontSize: "0.875rem", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)" }}>{ob.title}</span>
                <div style={{ width: "8rem", flexShrink: 0 }}>
                  <div style={{ height: "0.375rem", borderRadius: "9999px", overflow: "hidden", background: "var(--color-border)" }}>
                    {ob.count !== "—" && ob.pct > 0 && <div style={{ height: "100%", width: `${ob.pct}%`, borderRadius: "9999px", background: ob.barColor }} />}
                  </div>
                </div>
                <span style={{ fontSize: "0.75rem", width: "2.5rem", textAlign: "right", flexShrink: 0, color: "var(--color-muted)" }}>{ob.count}</span>
                <span style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", width: "6rem", textAlign: "right", flexShrink: 0, color: ob.statusColor }}>
                  {ob.statusLabel}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Productions */}
        <p style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>
          Productions ({PROD_COMPLIANCE_PRODS.length})
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {PROD_COMPLIANCE_PRODS.map((prod) => {
            const ringOffset = circ22 * (1 - prod.score / 100);
            const castColour = prod.castPct === 100 ? "#1a7f37" : prod.castPct > 50 ? "#b45309" : "#c0392b";
            return (
              <div key={prod.name} style={{ border: `1px solid ${prod.border}`, borderRadius: "4px", background: "var(--color-surface)", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", cursor: "default" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)", margin: "0 0 0.125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prod.name}</p>
                    <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: 0 }}>{prod.type} · {prod.licences} licence{prod.licences !== 1 ? "s" : ""}</p>
                  </div>
                  <span style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0.2rem 0.5rem", borderRadius: "4px", background: prod.bg, color: prod.color, border: `1px solid ${prod.border}`, flexShrink: 0 }}>
                    {prod.statusLabel}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
                    <svg width="56" height="56" viewBox="0 0 56 56">
                      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--color-border)" strokeWidth="5" />
                      <circle cx="28" cy="28" r="22" fill="none" stroke={prod.color} strokeWidth="5" strokeDasharray={circ22} strokeDashoffset={ringOffset} strokeLinecap="round" transform="rotate(-90 28 28)" />
                    </svg>
                    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8125rem", fontWeight: 700, color: prod.color, lineHeight: 1 }}>{prod.score}%</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {prod.obligations.map((ob) => (
                      <div key={ob.label} style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--color-muted)", overflow: "hidden" }}>
                        <span style={{ flexShrink: 0, color: ob.color }}>{ob.icon}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ob.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "0.5rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "4px", background: "var(--color-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.375rem" }}>
                    <span style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)" }}>Cast Onboarding</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: castColour }}>{prod.castConsented}/{prod.castTotal}</span>
                  </div>
                  <div style={{ height: "0.375rem", borderRadius: "9999px", overflow: "hidden", background: "var(--color-border)" }}>
                    <div style={{ height: "100%", width: `${prod.castPct}%`, borderRadius: "9999px", background: castColour }} />
                  </div>
                  {prod.castPct === 100
                    ? <p style={{ fontSize: "0.625rem", color: "#1a7f37", margin: "0.375rem 0 0" }}>✓ All cast onboarded</p>
                    : <p style={{ fontSize: "0.625rem", color: castColour, margin: "0.375rem 0 0" }}>⏳ {prod.castTotal - prod.castConsented} invite{prod.castTotal - prod.castConsented !== 1 ? "s" : ""} pending</p>
                  }
                </div>
                <p style={{ fontSize: "0.625rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-muted)", opacity: 0.7, margin: 0 }}>Click for details →</p>
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
      {/* Mode switcher */}
      <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.875rem", justifyContent: "center" }}>
        {([["talent", "Talent"], ["rep", "Rep"], ["production", "Production"]] as [DemoMode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              padding: "0.3rem 0.875rem",
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
            {label}
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

// ─── Mobile gate ─────────────────────────────────────────────────────────────

function MobileGate() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      padding: "2.5rem 2rem",
      background: "var(--color-bg)",
      textAlign: "center",
    }}>
      <div style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: "0.9375rem", fontWeight: 500, letterSpacing: "0.05em", color: "var(--color-ink)" }}>
          Image Vault
        </div>
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

// ─── Active nav ID per scene ──────────────────────────────────────────────────

function activeNavId(scene: Scene): NavId {
  if (scene.view === "rep-roster" || scene.view === "rep-detail") return "roster";
  if (scene.view === "vault") return "vault";
  if (scene.view === "productions-list" || scene.view === "add-cast") return "productions";
  if (scene.view === "compliance-dashboard") return "compliance";
  return "licences";
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DemoClient() {
  const [isMobile] = useState<boolean | null>(() =>
    typeof window !== "undefined" ? window.innerWidth < 1024 : null
  );
  const [mode, setMode] = useState<DemoMode>("talent");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const scenes = mode === "talent" ? SCENES : mode === "rep" ? REP_SCENES : PRODUCTION_SCENES;

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

      <DemoSidebar role={scene.sidebarRole} activeNavId={activeNavId(scene)} />

      <main style={{ flex: 1, overflow: "hidden", background: "var(--color-bg)", position: "relative", display: "flex", flexDirection: "column" }}>
        <div key={scene.id} className="demo-view-enter" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {scene.view === "vault" && <VaultView />}
          {scene.view === "licences" && (
            <LicencesView licences={scene.licences ?? ALL_LICENCES} expandedId={scene.expandedLic} />
          )}
          {scene.view === "download" && <DualCustodyDownloadView />}
          {scene.view === "rep-roster" && <RosterView />}
          {scene.view === "rep-detail" && <RepDetailLayout tab={scene.repTab ?? "vault"} />}
          {scene.view === "productions-list" && <ProductionsListView />}
          {scene.view === "add-cast" && <AddCastView />}
          {scene.view === "incoming-request" && <IncomingRequestView />}
          {scene.view === "compliance-dashboard" && <ComplianceDashboardView />}
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
