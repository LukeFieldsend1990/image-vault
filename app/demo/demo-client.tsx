"use client";

import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LicenceStatus = "APPROVED" | "PENDING";
type ViewType = "vault" | "licences" | "download" | "rep-roster" | "rep-detail";
type RepTab = "vault" | "licences" | "permissions" | "revenue";
type SidebarRole = "talent" | "licensee" | "rep";
type DemoMode = "talent" | "rep";
type NavId = "vault" | "licences" | "directory" | "settings" | "roster";
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
    name: "Base_Scan_26",
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
    packageName: "Base_Scan_26",
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
    packageName: "Base_Scan_26",
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
  { label: "Commercial", status: "approval_required" },
  { label: "Film / Double", status: "allowed" },
  { label: "Game Character", status: "approval_required" },
  { label: "AI Avatar", status: "blocked" },
  { label: "AI Training Data", status: "blocked" },
  { label: "Monitoring Reference", status: "allowed" },
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
    body: "Richard Robinson manages Channing Tatum across all licence requests, approvals and downloads. One view for every active deal.",
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
    body: "Calamity Hustle is awaiting approval. Richard can approve or deny licence requests directly on Channing's behalf.",
  },
  {
    id: "rep-permissions",
    view: "rep-detail",
    repTab: "permissions",
    expandedLic: null,
    sidebarRole: "rep",
    headline: "Usage permissions",
    body: "AI avatars are blocked, commercial requires approval. Richard sets usage rules to protect Channing's likeness across all future requests.",
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

const PERM_BG: Record<PermissionStatus, string> = {
  allowed: "#f0fdf4",
  approval_required: "#fffbeb",
  blocked: "#fef2f2",
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
  const nav = role === "talent" ? TALENT_NAV : role === "rep" ? REP_NAV : LICENSEE_NAV;
  const user =
    role === "talent"
      ? { initials: "ER", name: "Emma Richardson", subtitle: "Talent" }
      : role === "rep"
      ? { initials: "RR", name: "Richard Robinson", subtitle: "United Talent · Rep" }
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
  return (
    <div style={{ overflowY: "auto", height: "100%", padding: "2rem 3rem", paddingBottom: "13rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>
            Talent Roster
          </h1>
          <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.25rem 0 0" }}>
            {ROSTER.length} talents under management
          </p>
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", fontSize: "0.75rem", fontWeight: 500, color: "#fff", background: "var(--color-ink)", border: "none", borderRadius: "var(--radius)", cursor: "default" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Talent
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {ROSTER.map((talent, i) => (
          <div
            key={talent.id}
            style={{
              border: "1px solid var(--color-border)",
              borderLeft: i === 0 ? "3px solid var(--color-accent)" : "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{
                width: "2.5rem",
                height: "2.5rem",
                borderRadius: "50%",
                background: i === 0 ? "#c0392b" : "var(--color-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.6875rem",
                fontWeight: 700,
                color: i === 0 ? "#fff" : "var(--color-muted)",
                flexShrink: 0,
              }}>
                {talent.initials}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.125rem" }}>
                  <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-ink)" }}>{talent.name}</span>
                  {talent.pendingLicences > 0 && (
                    <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "9999px", background: "#fffbeb", color: "#b45309" }}>
                      {talent.pendingLicences} pending
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: 0 }}>
                  {talent.packages} scan package{talent.packages !== 1 ? "s" : ""}
                </p>
              </div>

              <button style={{ padding: "0.375rem 0.75rem", fontSize: "0.75rem", fontWeight: 500, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-bg)", color: "var(--color-muted)", cursor: "default", flexShrink: 0 }}>
                View
              </button>
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
  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0 0 1rem" }}>
        Controls how Channing&apos;s likeness may be used across any licence request.
      </p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {CT_PERMISSIONS.map((p, i) => (
          <div
            key={p.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.75rem 1rem",
              borderBottom: i < CT_PERMISSIONS.length - 1 ? "1px solid var(--color-border)" : "none",
              background: "var(--color-surface)",
            }}
          >
            <span style={{ fontSize: "0.8125rem", color: "var(--color-ink)" }}>{p.label}</span>
            <span style={{
              fontSize: "0.625rem",
              fontWeight: 600,
              padding: "0.15rem 0.5rem",
              borderRadius: "9999px",
              background: PERM_BG[p.status],
              color: PERM_COLOUR[p.status],
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}>
              {PERM_LABEL[p.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepRevenueTab() {
  const gross = 35000000;
  const talentCut = Math.round(gross * 0.65);
  const agencyCut = Math.round(gross * 0.20);
  const platformCut = Math.round(gross * 0.15);

  return (
    <div style={{ padding: "1.5rem 2rem", paddingBottom: "13rem", overflowY: "auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", margin: "0 0 0.25rem" }}>Total Gross Revenue</p>
        <p style={{ fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--color-ink)", margin: 0 }}>{fmtUSD(gross)}</p>
      </div>

      <div style={{ display: "flex", height: "0.375rem", borderRadius: "9999px", overflow: "hidden", marginBottom: "1rem", gap: "2px" }}>
        <div style={{ width: "65%", background: "#c0392b", borderRadius: "9999px 0 0 9999px" }} />
        <div style={{ width: "20%", background: "#475569" }} />
        <div style={{ width: "15%", background: "#94a3b8", borderRadius: "0 9999px 9999px 0" }} />
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "1.5rem" }}>
        {[
          { label: "Channing Tatum", sub: "65% talent share", value: talentCut, dot: "#c0392b" },
          { label: "United Talent Agency", sub: "20% agency commission", value: agencyCut, dot: "#475569" },
          { label: "Image Vault", sub: "15% platform fee", value: platformCut, dot: "#94a3b8" },
        ].map((r, i, arr) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: i < arr.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
              <div style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", background: r.dot, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--color-ink)", margin: 0 }}>{r.label}</p>
                <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: "0.1rem 0 0" }}>{r.sub}</p>
              </div>
            </div>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)" }}>{fmtUSD(r.value)}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-muted)", margin: "0 0 0.75rem" }}>Licence Revenue</p>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {CT_LICENCES.map((lic, i) => {
          const fee = lic.agreedFee ?? lic.proposedFee ?? 0;
          const colour = STATUS_COLOUR[lic.status] ?? "#6b7280";
          return (
            <div key={lic.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem", borderBottom: i < CT_LICENCES.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-surface)" }}>
              <div>
                <p style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--color-ink)", margin: 0 }}>{lic.projectName}</p>
                <p style={{ fontSize: "0.6875rem", color: "var(--color-muted)", margin: "0.1rem 0 0" }}>{lic.productionCompany}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-ink)", margin: "0 0 0.2rem" }}>{fmtUSD(fee)}</p>
                <span style={{ fontSize: "0.625rem", fontWeight: 600, padding: "0.1rem 0.4rem", borderRadius: "9999px", background: `${colour}18`, color: colour }}>
                  {lic.status}
                </span>
              </div>
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
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Acting-as banner */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 2rem",
        background: "rgba(192,57,43,0.05)",
        borderBottom: "1px solid rgba(192,57,43,0.12)",
        fontSize: "0.6875rem",
        color: "#c0392b",
        flexShrink: 0,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
        </svg>
        Acting as <strong style={{ marginLeft: "0.25rem" }}>Channing Tatum</strong>
        <span style={{ marginLeft: "0.375rem", fontSize: "0.55rem", fontWeight: 700, padding: "0.15rem 0.4rem", background: "rgba(192,57,43,0.12)", borderRadius: "2px", letterSpacing: "0.08em" }}>
          DELEGATED
        </span>
      </div>

      {/* Talent header + tab bar */}
      <div style={{ padding: "1.25rem 2rem 0", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ width: "2.75rem", height: "2.75rem", borderRadius: "50%", background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
            CT
          </div>
          <div>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em", color: "var(--color-ink)", margin: 0 }}>
              Channing Tatum
            </h1>
            <p style={{ fontSize: "0.75rem", color: "var(--color-muted)", margin: "0.125rem 0 0" }}>
              Talent · 3 scan packages · 1 pending licence
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
        {(["talent", "rep"] as DemoMode[]).map((m) => (
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
              textTransform: "capitalize",
              transition: "all 0.15s ease",
            }}
          >
            {m === "talent" ? "Talent" : "Rep"}
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

// ─── Active nav ID per scene ──────────────────────────────────────────────────

function activeNavId(scene: Scene): NavId {
  if (scene.view === "rep-roster" || scene.view === "rep-detail") return "roster";
  if (scene.view === "vault") return "vault";
  return "licences";
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DemoClient() {
  const [mode, setMode] = useState<DemoMode>("talent");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const scenes = mode === "talent" ? SCENES : REP_SCENES;
  const scene = scenes[sceneIndex];

  const handleModeChange = (m: DemoMode) => {
    setMode(m);
    setSceneIndex(0);
  };

  useEffect(() => {
    if (paused) return;
    const currentScenes = mode === "talent" ? SCENES : REP_SCENES;
    const t = setTimeout(() => {
      setSceneIndex((i) => (i + 1) % currentScenes.length);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [sceneIndex, paused, mode]);

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
