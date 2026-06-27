"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import OrgMembersPanel from "./org-members-panel";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";
import LicenceRef from "@/app/components/licence-ref";
import { formatScan } from "@/lib/codes/codes";

type LicenceStatus =
  | "AWAITING_PACKAGE"
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "SCRUB_PERIOD"
  | "CLOSED"
  | "OVERDUE";
type LicenceTab = "active" | "requests" | "expired" | "history";

interface Licence {
  id: string;
  shortCode: string | null;
  packageName: string | null;
  packageScanNumber?: number | null;
  projectName: string;
  productionCompany: string;
  intendedUse: string;
  validFrom: number;
  validTo: number;
  status: LicenceStatus;
  approvedAt: number | null;
  deniedAt: number | null;
  deniedReason: string | null;
  downloadCount: number;
  lastDownloadAt: number | null;
  createdAt: number;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  permitAiTraining: boolean;
  proposedFee: number | null;
  agreedFee: number | null;
  platformFee: number | null;
  agencySharePct: number | null;
  talentSharePct: number | null;
  deliveryMode: "standard" | "bridge_only" | null;
  preauthUntil: number | null;
  preauthSetBy: string | null;
  contractUrl: string | null;
  contractUploadedAt: number | null;
  organisationId: string | null;
  orgName?: string | null;
  orgType?: string | null;
  orgShortCode?: string | null;
  talentShortCode?: string | null;
  productionId: string | null;
  licenseeId: string;
  talentId: string | null;
}

interface ScrubData {
  scrubDeadline: number | null;
  daysRemaining: number | null;
  overdue: boolean;
  scrubAttestedAt: number | null;
  attestation: {
    attestedAt: number;
    devicesScrubbed: string[];
    bridgeCachePurged: boolean;
    additionalNotes: string | null;
  } | null;
}

interface BridgeAgentStatus {
  agentId: string;
  displayName: string;
  organisationName: string;
  agentOnline: boolean;
  lastHeartbeatAt: number | null;
  publishedPackages: Array<{ packageId: string; packageName: string }>;
  status: string;
  pendingAction: string | null;
}

interface PendingDownload {
  licenceId: string;
  projectName: string;
  productionCompany: string;
  packageId: string;
}

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  AWAITING_PACKAGE: "#7c3aed",
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
  SCRUB_PERIOD: "#c0392b",
  CLOSED: "#374151",
  OVERDUE: "#991b1b",
};

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI Training Data",
  monitoring_reference: "Identity / Security Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtGBP(pence: number) {
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// Map of licenceId → bridge agent status; re-fetches when the set of project-scoped licences changes.
function useBridgeAgents(licences: Licence[]) {
  const [agentsByLicence, setAgentsByLicence] = useState<Record<string, BridgeAgentStatus | null>>({});
  const projectCount = licences.filter(l => l.organisationId && l.status === "APPROVED").length;

  useEffect(() => {
    if (projectCount === 0) return;
    let alive = true;

    async function fetchAgents() {
      try {
        const r = await fetch("/api/bridge/render-bridge");
        if (!alive || !r.ok) return;
        const d = await r.json() as { agents?: Array<BridgeAgentStatus & { licences: Array<{ licenceId: string }> }> };
        if (!alive) return;
        const map: Record<string, BridgeAgentStatus | null> = {};
        for (const agent of d.agents ?? []) {
          for (const al of agent.licences) {
            map[al.licenceId] = agent;
          }
        }
        setAgentsByLicence(map);
      } catch { /* non-critical */ }
    }

    void fetchAgents();
    const id = setInterval(() => { void fetchAgents(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [projectCount]);

  return agentsByLicence;
}

function timeSince(ts: number | null): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function RenderBridgePanel({ agent, licencePackageId }: { agent: BridgeAgentStatus; licencePackageId: string | null }) {
  const isRevoked = agent.status === "revoked";
  const isPurging = agent.pendingAction === "purge";
  const packagePublished = licencePackageId
    ? agent.publishedPackages.some(p => p.packageId === licencePackageId)
    : false;

  const statusColor = isRevoked ? "#6b7280" : isPurging ? "#c0392b" : agent.agentOnline ? "#16a34a" : "#9ca3af";
  const statusLabel = isRevoked ? "Revoked" : isPurging ? "Purging" : agent.agentOnline ? "Online" : "Offline";

  return (
    <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: "#0a0a0a" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
          </svg>
          <span className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>
            Render Bridge
          </span>
          <span className="font-mono text-[11px] truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
            {agent.displayName}
          </span>
        </div>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {agent.agentOnline && !isRevoked && !isPurging ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: statusColor }} />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: statusColor }} />
            </span>
          ) : (
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
          )}
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap" style={{ background: "var(--color-surface)" }}>
        <div className="space-y-1">
          <p className="text-xs" style={{ color: "var(--color-ink)" }}>
            <span style={{ color: "var(--color-muted)" }}>Facility: </span>
            {agent.organisationName}
          </p>
          {licencePackageId && (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              Package status:{" "}
              {packagePublished ? (
                <span style={{ color: "#16a34a" }}>published to render share</span>
              ) : (
                <span>not yet published</span>
              )}
            </p>
          )}
          {agent.publishedPackages.length > 1 && (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {agent.publishedPackages.length} packages total on share
            </p>
          )}
        </div>
        <p className="text-[11px] font-mono flex-shrink-0" style={{ color: "var(--color-muted)" }}>
          {agent.lastHeartbeatAt ? timeSince(agent.lastHeartbeatAt) : "no heartbeat"}
        </p>
      </div>
    </div>
  );
}

export default function TalentLicencesClient({ role = "talent", highlight = null }: { role?: string; highlight?: string | null }) {
  const [licences, setLicences] = useState<Licence[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [togglingDeliveryId, setTogglingDeliveryId] = useState<string | null>(null);
  const [cancellingPreauthId, setCancellingPreauthId] = useState<string | null>(null);
  const [uploadingContractId, setUploadingContractId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LicenceTab>("active");
  const [scrubDataById, setScrubDataById] = useState<Record<string, ScrubData | "loading">>({});
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  // Rep mode: packages keyed by talentId (fetched per-talent via ?for=)
  const [talentPackages, setTalentPackages] = useState<Record<string, { id: string; name: string }[]>>({});
  const [attachingPkg, setAttachingPkg] = useState<Record<string, string>>({});
  const [attachingId, setAttachingId] = useState<string | null>(null);

  // Download Requests tab state
  const [pendingDownloads, setPendingDownloads] = useState<PendingDownload[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);

  const agentsByLicence = useBridgeAgents(licences);

  const highlightedRef = useRef(false);

  async function load() {
    const r = await fetch("/api/licences");
    const d = await r.json() as { licences?: Licence[] };
    setLicences((d.licences ?? []).filter((l) => l.status !== "PENDING" && l.status !== "AWAITING_PACKAGE"));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  // Scroll to + expand the highlighted licence once licences are loaded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!highlight || licences.length === 0 || highlightedRef.current) return;
    highlightedRef.current = true;

    const target = licences.find((l) => l.id === highlight);
    if (!target) return;

    const ts = Math.floor(Date.now() / 1000);
    let tab: LicenceTab = "active";
    if (target.status === "APPROVED" && target.validTo + 86400 > ts) {
      tab = "active";
    } else if (target.status === "EXPIRED" || (target.status === "APPROVED" && target.validTo + 86400 <= ts)) {
      tab = "expired";
    } else if (["DENIED", "REVOKED", "SCRUB_PERIOD", "OVERDUE", "CLOSED"].includes(target.status)) {
      tab = "history";
    }

    setActiveTab(tab);
    setExpandedId(highlight);
    setTimeout(() => {
      document.getElementById(`licence-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  }, [highlight, licences]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch("/api/vault/packages")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { packages?: { id: string; name: string; status?: string }[] };
        setPackages((data.packages ?? []).filter((p) => p.status === "ready"));
      })
      .catch(() => {/* non-fatal */});
  }, []);

  // Rep mode: fetch each managed talent's packages so the rep can attach them.
  useEffect(() => {
    if (role !== "rep" || licences.length === 0) return;
    const ids = [...new Set(
      licences
        .filter((l) => l.status === "APPROVED" && l.productionId && !l.packageName && l.talentId)
        .map((l) => l.talentId!)
    )];
    if (ids.length === 0) return;
    void Promise.all(ids.map(async (talentId) => {
      try {
        const r = await fetch(`/api/vault/packages?for=${talentId}`);
        const d = await r.json() as { packages?: { id: string; name: string; status?: string }[] };
        setTalentPackages((prev) => ({
          ...prev,
          [talentId]: (d.packages ?? []).filter((p) => p.status === "ready"),
        }));
      } catch { /* non-fatal */ }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, licences]);

  async function attachPackage(licenceId: string) {
    const pkgId = attachingPkg[licenceId];
    if (!pkgId) return;
    setAttachingId(licenceId);
    await fetch(`/api/licences/${licenceId}/attach-package`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId: pkgId }),
    });
    await load();
    setAttachingId(null);
  }

  async function loadRequests() {
    if (requestsLoaded) return;
    setRequestsLoading(true);
    try {
      const r = await fetch("/api/licences?status=APPROVED");
      const d = await r.json() as { licences?: Array<{ id: string; projectName: string; productionCompany: string; packageId: string }> };
      const approved = d.licences ?? [];
      const results = await Promise.all(
        approved.map(async (l) => {
          const sr = await fetch(`/api/licences/${l.id}/download/status`);
          const s = await sr.json() as { step?: string | null };
          if (s.step === "awaiting_talent") {
            return { licenceId: l.id, projectName: l.projectName, productionCompany: l.productionCompany, packageId: l.packageId } as PendingDownload;
          }
          return null;
        })
      );
      setPendingDownloads(results.filter(Boolean) as PendingDownload[]);
    } finally {
      setRequestsLoading(false);
      setRequestsLoaded(true);
    }
  }

  useEffect(() => {
    if (activeTab === "requests") void loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function toggleDeliveryMode(l: Licence) {
    const next = l.deliveryMode === "bridge_only" ? "standard" : "bridge_only";
    setTogglingDeliveryId(l.id);
    await fetch(`/api/licences/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryMode: next }),
    });
    setLicences((prev) => prev.map((x) => x.id === l.id ? { ...x, deliveryMode: next } : x));
    setTogglingDeliveryId(null);
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this licence? Any pending downloads will be cancelled.")) return;
    setRevokingId(id);
    await fetch(`/api/licences/${id}/revoke`, { method: "POST" });
    await load();
    setRevokingId(null);
  }

  async function uploadContract(id: string, file: File) {
    if (file.size > 20 * 1024 * 1024) { alert("File exceeds 20 MB limit."); return; }
    if (file.type && file.type !== "application/pdf") { alert("PDF only."); return; }
    setUploadingContractId(id);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/licences/${id}/contract/file`, { method: "POST", body: fd });
    setUploadingContractId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Upload failed" })) as { error?: string };
      alert(body.error ?? "Upload failed");
      return;
    }
    await load();
  }

  function fetchScrubData(id: string) {
    if (scrubDataById[id]) return;
    setScrubDataById((prev) => ({ ...prev, [id]: "loading" }));
    fetch(`/api/licences/${id}/scrub`)
      .then((r) => r.json())
      .then((d) => setScrubDataById((prev) => ({ ...prev, [id]: d as ScrubData })))
      .catch(() => setScrubDataById((prev) => ({ ...prev, [id]: { scrubDeadline: null, daysRemaining: null, overdue: false, scrubAttestedAt: null, attestation: null } })));
  }

  async function cancelPreauth(id: string) {
    if (!confirm("Remove pre-authorisation? Future downloads will require your 2FA again.")) return;
    setCancellingPreauthId(id);
    await fetch(`/api/licences/${id}/preauth`, { method: "DELETE" });
    setLicences((prev) => prev.map((x) => x.id === id ? { ...x, preauthUntil: null, preauthSetBy: null } : x));
    setCancellingPreauthId(null);
  }

  const now = Math.floor(Date.now() / 1000);
  // validTo is stored as midnight of the expiry date — licence is valid through end of that day
  const activeLicences = licences.filter((l) => l.status === "APPROVED" && l.validTo + 86400 > now);
  const expiredLicences = licences.filter((l) => l.status === "EXPIRED" || (l.status === "APPROVED" && l.validTo + 86400 <= now));
  const historyLicences = licences.filter(
    (l) =>
      l.status === "DENIED" ||
      l.status === "REVOKED" ||
      l.status === "SCRUB_PERIOD" ||
      l.status === "OVERDUE" ||
      l.status === "CLOSED",
  );

  const visibleLicences = activeTab === "active" ? activeLicences
    : activeTab === "expired" ? expiredLicences
    : activeTab === "history" ? historyLicences
    : [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Licences
        </h1>
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b mb-6" style={{ borderColor: "var(--color-border)" }}>
        {([
          { id: "active" as LicenceTab, label: "Active", count: activeLicences.length },
          { id: "requests" as LicenceTab, label: "Download Requests", count: pendingDownloads.length, pulse: pendingDownloads.length > 0 },
          { id: "expired" as LicenceTab, label: "Expired", count: expiredLicences.length },
          { id: "history" as LicenceTab, label: "Ended", count: historyLicences.length },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative py-2.5 px-1 mr-6 text-sm font-medium transition whitespace-nowrap flex-shrink-0"
            style={{ color: activeTab === tab.id ? "var(--color-ink)" : "var(--color-muted)" }}
          >
            {tab.label}
            {(tab.count > 0 || tab.id === "requests") && (
              <span
                className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  background: tab.id === "requests" && tab.count > 0
                    ? "var(--color-accent)"
                    : activeTab === tab.id ? "var(--color-accent)" : "var(--color-border)",
                  color: (tab.id === "requests" && tab.count > 0) || activeTab === tab.id ? "#fff" : "var(--color-muted)",
                }}
              >
                {tab.id === "requests" && !requestsLoaded ? "·" : tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "var(--color-accent)" }} />
            )}
          </button>
        ))}
      </div>

      {/* ── Download Requests tab ──────────────────────────────────────────── */}
      {activeTab === "requests" && (
        <div>
          {requestsLoading && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>Checking for pending requests…</p>
          )}
          {!requestsLoading && pendingDownloads.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No download requests awaiting your approval.</p>
          )}
          <div className="space-y-3">
            {pendingDownloads.map((p) => (
              <div key={p.licenceId} className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>{p.projectName}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{p.productionCompany}</p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
                      Awaiting your approval
                    </div>
                  </div>
                  <Link
                    href={`/vault/authorise/${p.licenceId}`}
                    className="flex-shrink-0 rounded px-4 py-2 text-xs font-medium text-white transition"
                    style={{ background: "var(--color-accent)" }}
                  >
                    Review &amp; Authorise
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Active / History tabs ──────────────────────────────────────────── */}
      {activeTab !== "requests" && (
        <>
          {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
          {!loading && visibleLicences.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {activeTab === "active" ? "No active licences."
            : activeTab === "expired" ? "No expired licences."
            : "No denied or revoked licences."}
            </p>
          )}

          <div className="space-y-3">
            {visibleLicences.map((l) => {
              const expanded = expandedId === l.id;
              const feeRef = l.agreedFee ?? l.proposedFee;
              const sharePct = role === "rep" ? (l.agencySharePct ?? 10) : (l.talentSharePct ?? 80);
              const netEarnings = feeRef ? Math.round(feeRef * sharePct / 100) : null;
              const platformPct = 100 - (l.agencySharePct ?? 10) - (l.talentSharePct ?? 80);
              const preauthActive = l.preauthUntil !== null && l.preauthUntil > now;
              const isExpired = l.validTo + 86400 <= now || l.status === "EXPIRED";

              return (
                <div key={l.id} id={`licence-${l.id}`} className="rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", scrollMarginTop: 80 }}>
                  <div className="p-5">
                    {/* ── Summary row ─────────────────────────────────────── */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                            <span>{l.projectName}</span>
                            <LicenceRef code={l.shortCode} />
                            <CodeTag code={l.talentShortCode} />
                          </p>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            style={{ background: `${STATUS_COLOURS[l.status]}18`, color: STATUS_COLOURS[l.status] }}>
                            {l.status}
                          </span>
                          {l.licenceType && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "var(--color-border)", color: "var(--color-muted)" }}>
                              {LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType}
                            </span>
                          )}
                          {preauthActive && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: "rgba(22,101,52,0.12)", color: "#166534" }}>
                              Pre-auth until {formatDate(l.preauthUntil!)}
                            </span>
                          )}
                          {l.organisationId && agentsByLicence[l.id] && (
                            <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                background: agentsByLicence[l.id]!.agentOnline ? "rgba(22,163,74,0.12)" : "rgba(156,163,175,0.15)",
                                color: agentsByLicence[l.id]!.agentOnline ? "#16a34a" : "#9ca3af",
                              }}>
                              {agentsByLicence[l.id]!.agentOnline ? (
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: "#16a34a" }} />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#16a34a" }} />
                                </span>
                              ) : (
                                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#9ca3af" }} />
                              )}
                              Render Bridge
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs flex items-center gap-1.5 flex-wrap" style={{ color: "var(--color-muted)" }}>
                          <span>{l.productionCompany}</span>
                          {l.organisationId && <OrgTypeBadge type={l.orgType} />}
                          {l.organisationId && <CodeTag code={l.orgShortCode} />}
                          <span>· {l.packageName ?? "—"}</span>
                          <CodeTag code={formatScan(l.packageScanNumber)} />
                        </p>
                        {l.organisationId && (
                          <OrgMembersPanel organisationId={l.organisationId} submittedByUserId={l.licenseeId} />
                        )}
                        <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                          Period: {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                        </p>
                        {netEarnings !== null && feeRef !== null && (
                          <>
                            <p className="mt-1 text-xs font-medium" style={{ color: "var(--color-accent)" }}>
                              {l.agreedFee ? "Agreed fee" : "Proposed fee"}: {fmtGBP(feeRef)}
                            </p>
                            <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--color-accent)" }}>
                              Your earnings: {fmtGBP(netEarnings)}
                            </p>
                          </>
                        )}
                        {l.downloadCount > 0 && (
                          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                            Downloaded {l.downloadCount}× · Last: {formatDate(l.lastDownloadAt)}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const next = expanded ? null : l.id;
                            setExpandedId(next);
                            if (next && (l.status === "CLOSED" || l.status === "SCRUB_PERIOD" || l.status === "OVERDUE")) {
                              fetchScrubData(l.id);
                            }
                          }}
                          className="flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                        >
                          Details
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        <Link href={`/consent/${l.id}`}
                          className="rounded border px-2.5 py-1.5 text-xs font-medium transition"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}
                          title="Open the consent document for this licence">
                          Consent doc
                        </Link>
                        <a href={`/api/licences/${l.id}/contract`} target="_blank" rel="noopener noreferrer"
                          className="rounded border px-2.5 py-1.5 text-xs transition"
                          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)" }}>
                          Contract
                        </a>
                        {l.contractUrl ? (
                          <a href={`/api/licences/${l.id}/contract/file`} target="_blank" rel="noopener noreferrer"
                            className="rounded border px-2.5 py-1.5 text-xs transition"
                            style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", background: "var(--color-bg)" }}>
                            Signed PDF
                          </a>
                        ) : (
                          <label className="rounded border px-2.5 py-1.5 text-xs transition cursor-pointer"
                            style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-bg)", opacity: uploadingContractId === l.id ? 0.6 : 1 }}>
                            {uploadingContractId === l.id ? "Uploading…" : "Upload signed"}
                            <input type="file" accept="application/pdf" className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) void uploadContract(l.id, f);
                              }}
                              disabled={uploadingContractId === l.id} />
                          </label>
                        )}
                        {l.status === "APPROVED" && !isExpired && (
                          <button onClick={() => revoke(l.id)} disabled={revokingId === l.id}
                            className="rounded border px-3 py-1.5 text-xs transition disabled:opacity-60"
                            style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
                            {revokingId === l.id ? "Revoking…" : "Revoke"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ── Attach scan for APPROVED production licences with no package ── */}
                    {l.status === "APPROVED" && l.productionId && !l.packageName && (() => {
                      const pkgList = role === "rep"
                        ? (l.talentId ? (talentPackages[l.talentId] ?? []) : [])
                        : packages;
                      return (
                        <div
                          className="mt-3 rounded border p-3 space-y-2"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                        >
                          {pkgList.length > 0 ? (
                            <>
                              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                                This production licence has no scan attached.
                              </p>
                              <div className="flex gap-2 items-center flex-wrap">
                                <select
                                  value={attachingPkg[l.id] ?? ""}
                                  onChange={(e) => setAttachingPkg((prev) => ({ ...prev, [l.id]: e.target.value }))}
                                  className="flex-1 min-w-0 rounded border px-3 py-2 text-sm outline-none"
                                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
                                >
                                  <option value="">— select a package —</option>
                                  {pkgList.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => void attachPackage(l.id)}
                                  disabled={!attachingPkg[l.id] || attachingId === l.id}
                                  className="rounded px-3 py-2 text-xs font-medium text-white transition disabled:opacity-60"
                                  style={{ background: "var(--color-accent)" }}
                                >
                                  {attachingId === l.id ? "Attaching…" : "Attach"}
                                </button>
                              </div>
                            </>
                          ) : role === "rep" ? (
                            <>
                              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                                No scan package attached
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                                No scan has been uploaded for this licence yet. You can upload one on your client&apos;s behalf, or check for an incoming studio transfer.
                              </p>
                              <div className="flex gap-2 flex-wrap pt-1">
                                <Link
                                  href={l.talentId ? `/roster/${l.talentId}` : "/roster"}
                                  className="rounded px-3 py-1.5 text-xs font-medium text-white"
                                  style={{ background: "var(--color-accent)" }}
                                >
                                  Upload on their behalf
                                </Link>
                                <Link
                                  href="/transfers"
                                  className="rounded px-3 py-1.5 text-xs font-medium"
                                  style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)", background: "transparent" }}
                                >
                                  Check for incoming transfers
                                </Link>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                                No scan package attached
                              </p>
                              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                                This licence is waiting for a scan. You need to either upload your own scan package, or have a capture studio transfer one into your vault.
                              </p>
                              <div className="flex gap-2 flex-wrap pt-1">
                                <Link
                                  href="/dashboard"
                                  className="rounded px-3 py-1.5 text-xs font-medium text-white"
                                  style={{ background: "var(--color-accent)" }}
                                >
                                  Upload a scan
                                </Link>
                                <Link
                                  href="/transfers"
                                  className="rounded px-3 py-1.5 text-xs font-medium"
                                  style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)", background: "transparent" }}
                                >
                                  Check for incoming transfers
                                </Link>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Expanded details ─────────────────────────────────── */}
                    {expanded && (
                      <div className="mt-4 rounded border divide-y text-xs" style={{ borderColor: "var(--color-border)" }}>
                        {[
                          l.licenceType ? ["Usage type", LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType] : null,
                          l.territory ? ["Territory", l.territory] : null,
                          l.exclusivity ? ["Exclusivity", EXCLUSIVITY_LABELS[l.exclusivity] ?? l.exclusivity] : null,
                          ["AI processing", l.permitAiTraining ? "Permitted" : "Not permitted"],
                          l.deniedReason ? ["Denial reason", l.deniedReason] : null,
                        ]
                          .filter((row): row is [string, string] => row !== null)
                          .map(([key, value]) => (
                            <div key={key} className="flex justify-between gap-4 px-3 py-2">
                              <span style={{ color: "var(--color-muted)" }}>{key}</span>
                              <span className="font-medium text-right" style={{ color: key === "AI processing" && l.permitAiTraining ? "#b45309" : "var(--color-ink)" }}>
                                {value}
                              </span>
                            </div>
                          ))}

                        <div className="px-3 py-3">
                          <p className="mb-1" style={{ color: "var(--color-muted)" }}>Intended use</p>
                          <p className="leading-relaxed" style={{ color: "var(--color-ink)" }}>{l.intendedUse}</p>
                        </div>

                        {feeRef !== null && netEarnings !== null && (
                          <div className="px-3 py-3 space-y-1">
                            <p className="mb-2 font-medium" style={{ color: "var(--color-ink)" }}>Fee breakdown</p>
                            <div className="flex justify-between">
                              <span style={{ color: "var(--color-muted)" }}>{l.agreedFee ? "Agreed fee" : "Proposed fee"}</span>
                              <span style={{ color: "var(--color-ink)" }}>{fmtGBP(feeRef)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: "var(--color-muted)" }}>Platform fee ({platformPct}%)</span>
                              <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * platformPct / 100))}</span>
                            </div>
                            {role === "rep" ? (
                              <div className="flex justify-between">
                                <span style={{ color: "var(--color-muted)" }}>Talent share ({l.talentSharePct ?? 80}%)</span>
                                <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * (l.talentSharePct ?? 80) / 100))}</span>
                              </div>
                            ) : (
                              <div className="flex justify-between">
                                <span style={{ color: "var(--color-muted)" }}>Agency commission ({l.agencySharePct ?? 10}%)</span>
                                <span style={{ color: "var(--color-muted)" }}>−{fmtGBP(Math.round(feeRef * (l.agencySharePct ?? 10) / 100))}</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: "var(--color-border)" }}>
                              <span style={{ color: "var(--color-ink)" }}>Your earnings ({sharePct}%)</span>
                              <span style={{ color: "var(--color-accent)" }}>{fmtGBP(netEarnings)}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between gap-4 px-3 py-2">
                          <span style={{ color: "var(--color-muted)" }}>Approved</span>
                          <span className="font-medium" style={{ color: "var(--color-ink)" }}>{formatDate(l.approvedAt)}</span>
                        </div>

                        {/* ── Scrub attestation ─────────────────────────── */}
                        {(l.status === "CLOSED" || l.status === "SCRUB_PERIOD" || l.status === "OVERDUE") && (() => {
                          const sd = scrubDataById[l.id];
                          return (
                            <div className="px-3 py-3">
                              <p className="text-[10px] font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
                                Scrub attestation
                              </p>
                              {(!sd || sd === "loading") ? (
                                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                                  {sd === "loading" ? "Loading…" : "—"}
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {sd.scrubDeadline && (
                                    <div className="flex justify-between gap-4">
                                      <span style={{ color: "var(--color-muted)" }}>Deadline</span>
                                      <span style={{ color: sd.overdue ? "#c0392b" : "var(--color-ink)" }}>
                                        {formatDate(sd.scrubDeadline)}
                                        {sd.overdue ? " — overdue" : sd.daysRemaining !== null ? ` (${sd.daysRemaining}d remaining)` : ""}
                                      </span>
                                    </div>
                                  )}
                                  {sd.attestation ? (
                                    <>
                                      <div className="flex justify-between gap-4">
                                        <span style={{ color: "var(--color-muted)" }}>Attested on</span>
                                        <span className="font-medium" style={{ color: "var(--color-ink)" }}>{formatDate(sd.attestation.attestedAt)}</span>
                                      </div>
                                      <div>
                                        <p className="mb-1" style={{ color: "var(--color-muted)" }}>Devices scrubbed</p>
                                        <ul className="space-y-0.5 pl-0">
                                          {sd.attestation.devicesScrubbed.map((d, i) => (
                                            <li key={i} className="font-medium" style={{ color: "var(--color-ink)" }}>{d}</li>
                                          ))}
                                        </ul>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <span style={{ color: "var(--color-muted)" }}>Bridge cache purged</span>
                                        <span className="font-medium" style={{ color: sd.attestation.bridgeCachePurged ? "#166534" : "var(--color-muted)" }}>
                                          {sd.attestation.bridgeCachePurged ? "Confirmed" : "Not confirmed"}
                                        </span>
                                      </div>
                                      {sd.attestation.additionalNotes && (
                                        <div>
                                          <p className="mb-1" style={{ color: "var(--color-muted)" }}>Notes</p>
                                          <p style={{ color: "var(--color-ink)" }}>{sd.attestation.additionalNotes}</p>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <p style={{ color: "var(--color-muted)" }}>No attestation submitted yet.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* ── Render Bridge panel ───────────────────────── */}
                        {l.organisationId && agentsByLicence[l.id] && (
                          <div className="px-3 py-3">
                            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink)" }}>Render Bridge</p>
                            <RenderBridgePanel
                              agent={agentsByLicence[l.id]!}
                              licencePackageId={null}
                            />
                          </div>
                        )}
                        {l.organisationId && !agentsByLicence[l.id] && (
                          <div className="flex justify-between gap-4 px-3 py-2">
                            <span style={{ color: "var(--color-muted)" }}>Render Bridge</span>
                            <span className="text-xs" style={{ color: "var(--color-muted)" }}>No agent enrolled</span>
                          </div>
                        )}

                        {/* ── Delivery mode ─────────────────────────────── */}
                        {l.status === "APPROVED" && (
                          <div className="flex items-start justify-between gap-4 px-3 py-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>Delivery mode</p>
                              <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                                {l.deliveryMode === "bridge_only"
                                  ? "CAS Bridge only — licensee must use the desktop bridge app."
                                  : "Standard — licensee can download directly or via CAS Bridge."}
                              </p>
                            </div>
                            <div className="flex items-center rounded shrink-0 overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                              {([
                                { value: "standard", label: "Standard", color: "#166534" },
                                { value: "bridge_only", label: "CAS Bridge", color: "#92400e" },
                              ] as const).map((opt, idx, arr) => {
                                const active = (l.deliveryMode ?? "standard") === opt.value;
                                const isSaving = togglingDeliveryId === l.id;
                                return (
                                  <button key={opt.value} disabled={isSaving} onClick={() => void toggleDeliveryMode(l)}
                                    className="px-3 py-1.5 text-[11px] font-medium transition"
                                    style={{
                                      background: active ? `${opt.color}18` : "transparent",
                                      color: active ? opt.color : "var(--color-muted)",
                                      borderRight: idx < arr.length - 1 ? "1px solid var(--color-border)" : "none",
                                      cursor: isSaving ? "wait" : "pointer",
                                      opacity: isSaving && !active ? 0.5 : 1,
                                    }}>
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── Pre-auth status ────────────────────────────── */}
                        {l.status === "APPROVED" && !isExpired && (
                          <div className="flex items-start justify-between gap-4 px-3 py-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>Download pre-authorisation</p>
                              <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                                {preauthActive
                                  ? `Active — licensee can download without your 2FA until ${formatDate(l.preauthUntil!)}.`
                                  : "Not set — every download requires your 2FA approval."}
                              </p>
                            </div>
                            <div className="shrink-0 flex flex-col items-end gap-1.5">
                              {preauthActive ? (
                                <button
                                  onClick={() => void cancelPreauth(l.id)}
                                  disabled={cancellingPreauthId === l.id}
                                  className="rounded border px-2.5 py-1.5 text-[11px] transition disabled:opacity-60"
                                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                                >
                                  {cancellingPreauthId === l.id ? "Removing…" : "Remove pre-auth"}
                                </button>
                              ) : !l.permitAiTraining ? (
                                <Link
                                  href={`/vault/authorise/${l.id}`}
                                  className="rounded border px-2.5 py-1.5 text-[11px] transition"
                                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                                >
                                  {role === "rep" ? "Request pre-auth" : "Set pre-auth"}
                                </Link>
                              ) : (
                                <span className="text-[11px] italic" style={{ color: "var(--color-muted)" }}>
                                  Not available for AI training
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
