"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import OrgTypeBadge from "@/app/components/org-type-badge";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Production {
  id: string;
  name: string;
  companyName: string | null;
  type: string | null;
  year: number | null;
  status: string | null;
  sagProjectNumber: string | null;
  director: string | null;
  vfxSupervisor: string | null;
  organisationId: string | null;
  orgName?: string | null;
  orgType?: string | null;
  licenceCount: number;
}

interface CastRow {
  id: string;
  talentId: string | null;
  inviteId: string | null;
  licenceId: string | null;
  characterName: string | null;
  department: string | null;
  sagMember: boolean;
  status: "invited" | "linked" | "scan_uploaded" | "consented" | "declined";
  addedAt: number;
  linkedAt: number | null;
  talentProfile: { userId: string; fullName: string; profileImageUrl: string | null } | null;
  invite: { id: string; email: string; usedAt: number | null; expiresAt: number } | null;
  licence: { id: string; status: string; projectName: string } | null;
}

interface TmdbCastMember {
  tmdbId: number;
  name: string;
  character: string;
  department: string;
  profilePath?: string;
  matched: boolean;
  talentId?: string;
  talentEmail?: string;
}

interface LicenceSummary {
  id: string;
  talentName: string | null;
  talentEmail: string | null;
  status: string;
  licenceType: string | null;
  validFrom: number;
  validTo: number;
  agreedFee: number | null;
  proposedFee: number | null;
  packageName: string | null;
  productionId: string | null;
}

interface LicenceTerms {
  intendedUse: string;
  validFrom: string;
  validTo: string;
  licenceType: string;
  territory: string;
  exclusivity: string;
  permitAiTraining: boolean;
  proposedFee: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CAST_STATUS_COLOUR: Record<string, string> = {
  invited: "#b45309",
  linked: "#1d4ed8",
  scan_uploaded: "#7c3aed",
  consented: "#166534",
  declined: "#991b1b",
};

const CAST_STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  linked: "Linked",
  scan_uploaded: "Reviewing",
  consented: "Consented",
  declined: "Declined",
};

const TERRITORY_OPTIONS = [
  "Worldwide",
  "United Kingdom",
  "United States",
  "European Union",
  "North America",
  "Asia Pacific",
  "Other",
];

const LICENCE_TYPE_OPTIONS = [
  { value: "", label: "Select type…" },
  { value: "film_double", label: "Film / Double" },
  { value: "game_character", label: "Game Character" },
  { value: "commercial", label: "Commercial" },
  { value: "ai_avatar", label: "AI Avatar" },
  { value: "training_data", label: "Training Data" },
  { value: "monitoring_reference", label: "Identity Reference" },
];

const EXCLUSIVITY_OPTIONS = [
  { value: "non_exclusive", label: "Non-exclusive" },
  { value: "sole", label: "Sole" },
  { value: "exclusive", label: "Exclusive" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  color: "var(--color-text)",
  outline: "none",
};

const defaultTerms: LicenceTerms = {
  intendedUse: "",
  validFrom: "",
  validTo: "",
  licenceType: "film_double",
  territory: "",
  exclusivity: "non_exclusive",
  permitAiTraining: false,
  proposedFee: "",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductionDetailClient() {
  const { id } = useParams<{ id: string }>();

  const [production, setProduction] = useState<Production | null>(null);
  const [cast, setCast] = useState<CastRow[]>([]);
  const [castTotal, setCastTotal] = useState(0);
  const [consentedCount, setConsentedCount] = useState(0);
  const [invitedCount, setInvitedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Add cast tab: "tmdb" | "manual" | "csv"
  const [addTab, setAddTab] = useState<"tmdb" | "manual" | "csv">("manual");
  const [showAddPanel, setShowAddPanel] = useState(false);

  // Licence terms (shared across all members being added)
  const [terms, setTerms] = useState<LicenceTerms>(defaultTerms);

  // TMDB import
  const [tmdbCast, setTmdbCast] = useState<TmdbCastMember[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbFetched, setTmdbFetched] = useState(false);
  const [tmdbEmails, setTmdbEmails] = useState<Record<number, string>>({});
  const [tmdbSelected, setTmdbSelected] = useState<Set<number>>(new Set());
  // TMDB title search (shown when credits are empty)
  const [tmdbSearchQ, setTmdbSearchQ] = useState("");
  const [tmdbSearchResults, setTmdbSearchResults] = useState<{ id: number; title: string; mediaType: string; year: number | null }[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);

  // Manual entry
  const [manualEmail, setManualEmail] = useState("");
  const [manualCharacter, setManualCharacter] = useState("");
  const [manualDept, setManualDept] = useState("");
  const [manualSag, setManualSag] = useState(false);
  const [manualQueue, setManualQueue] = useState<{ email: string; characterName?: string; department?: string; sagMember: boolean }[]>([]);

  // CSV
  const csvRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<{ email: string; characterName?: string; department?: string; sagMember: boolean }[]>([]);
  const [csvError, setCsvError] = useState("");

  const [licences, setLicences] = useState<LicenceSummary[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, castRes, licRes] = await Promise.all([
        fetch(`/api/productions/${id}`),
        fetch(`/api/productions/${id}/cast`),
        fetch(`/api/licences`),
      ]);
      if (prodRes.ok) {
        const d = await prodRes.json() as { production: Production };
        setProduction(d.production);
      }
      if (castRes.ok) {
        const d = await castRes.json() as { cast: CastRow[]; castTotal: number; consentedCount: number; invitedCount: number };
        setCast(d.cast ?? []);
        setCastTotal(d.castTotal ?? 0);
        setConsentedCount(d.consentedCount ?? 0);
        setInvitedCount(d.invitedCount ?? 0);
      }
      if (licRes.ok) {
        const d = await licRes.json() as { licences?: LicenceSummary[] };
        setLicences((d.licences ?? []).filter((l) => l.productionId === id));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // TMDB import
  async function fetchTmdbCast() {
    setTmdbLoading(true);
    try {
      const r = await fetch(`/api/productions/${id}/cast/tmdb`);
      const d = await r.json() as { cast?: TmdbCastMember[] };
      const members: TmdbCastMember[] = d.cast ?? [];
      setTmdbCast(members);
      // Pre-select matched members
      setTmdbSelected(new Set(members.filter((m) => m.matched).map((m) => m.tmdbId)));
      setTmdbFetched(true);
    } finally {
      setTmdbLoading(false);
    }
  }

  async function searchTmdbTitles() {
    if (!tmdbSearchQ.trim()) return;
    setTmdbSearching(true);
    setTmdbSearchResults([]);
    try {
      const r = await fetch(`/api/productions/${id}/cast/tmdb/search?q=${encodeURIComponent(tmdbSearchQ)}`);
      const d = await r.json() as { results?: typeof tmdbSearchResults };
      setTmdbSearchResults(d.results ?? []);
    } finally {
      setTmdbSearching(false);
    }
  }

  async function selectTmdbTitle(tmdbId: number) {
    setTmdbSearchResults([]);
    setTmdbSearchQ("");
    setTmdbLoading(true);
    try {
      const r = await fetch(`/api/productions/${id}/cast/tmdb?overrideTmdbId=${tmdbId}`);
      const d = await r.json() as { cast?: TmdbCastMember[] };
      const members: TmdbCastMember[] = d.cast ?? [];
      setTmdbCast(members);
      setTmdbSelected(new Set(members.filter((m) => m.matched).map((m) => m.tmdbId)));
      setTmdbFetched(true);
    } finally {
      setTmdbLoading(false);
    }
  }

  // CSV parse
  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const rows: typeof csvRows = [];
      for (const line of lines.slice(1)) { // skip header
        const [email, sagMemberRaw, characterName, department] = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        rows.push({
          email: email.toLowerCase(),
          sagMember: sagMemberRaw?.toLowerCase() === "yes" || sagMemberRaw === "1" || sagMemberRaw?.toLowerCase() === "true",
          characterName: characterName || undefined,
          department: department || undefined,
        });
      }
      if (rows.length === 0) { setCsvError("No valid rows found. Expected columns: email, sag_member, character_name, department"); return; }
      setCsvRows(rows);
    };
    reader.readAsText(file);
  }

  // Add manual to queue
  function addToQueue() {
    if (!manualEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualEmail)) return;
    setManualQueue((q) => [...q, { email: manualEmail.toLowerCase(), characterName: manualCharacter || undefined, department: manualDept || undefined, sagMember: manualSag }]);
    setManualEmail(""); setManualCharacter(""); setManualDept(""); setManualSag(false);
    // Copy terms forward (already in state, no action needed)
  }

  // Build members array from the active tab
  function buildMembers() {
    const termsPayload = {
      intendedUse: terms.intendedUse,
      validFrom: terms.validFrom ? Math.floor(new Date(terms.validFrom).getTime() / 1000) : 0,
      validTo: terms.validTo ? Math.floor(new Date(terms.validTo).getTime() / 1000) : 0,
      licenceType: terms.licenceType || undefined,
      territory: terms.territory || undefined,
      exclusivity: terms.exclusivity || "non_exclusive",
      permitAiTraining: terms.permitAiTraining,
      proposedFee: terms.proposedFee ? parseInt(terms.proposedFee) * 100 : undefined,
    };

    if (addTab === "tmdb") {
      return [...tmdbSelected].map((tmdbId) => {
        const m = tmdbCast.find((x) => x.tmdbId === tmdbId)!;
        const email = m.talentEmail ?? tmdbEmails[tmdbId] ?? "";
        return { email, characterName: m.character, department: m.department, sagMember: false, ...termsPayload };
      }).filter((m) => m.email);
    }
    if (addTab === "csv") {
      return csvRows.map((m) => ({ ...m, ...termsPayload }));
    }
    // manual
    return manualQueue.map((m) => ({ ...m, ...termsPayload }));
  }

  async function handleSubmit() {
    const members = buildMembers();
    if (members.length === 0) { setSubmitError("No cast members to add."); return; }
    if (!terms.intendedUse.trim()) { setSubmitError("Intended use is required."); return; }
    if (!terms.validFrom || !terms.validTo) { setSubmitError("Licence dates are required."); return; }

    setSubmitting(true);
    setSubmitError("");
    try {
      const r = await fetch(`/api/productions/${id}/cast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members }),
      });
      const d = await r.json() as { error?: string; created?: number };
      if (!r.ok) { setSubmitError(d.error ?? "Failed to add cast members."); return; }
      setShowAddPanel(false);
      setManualQueue([]);
      setCsvRows([]);
      setTmdbCast([]);
      setTmdbFetched(false);
      setTmdbSelected(new Set());
      await fetchData();
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(castId: string) {
    setResendingId(castId);
    try {
      await fetch(`/api/productions/${id}/cast/${castId}/resend-invite`, { method: "POST" });
    } finally {
      setResendingId(null);
    }
  }

  async function handleRemove(castId: string) {
    if (!confirm("Remove this cast member? This cannot be undone.")) return;
    setRemovingId(castId);
    try {
      const r = await fetch(`/api/productions/${id}/cast/${castId}`, { method: "DELETE" });
      if (r.ok) await fetchData();
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl space-y-4">
        {[0, 1, 2].map((i) => <div key={i} className="rounded animate-pulse" style={{ height: 60, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />)}
      </div>
    );
  }

  if (!production) {
    return (
      <div className="p-8 max-w-5xl">
        <p style={{ color: "var(--color-muted)" }}>Production not found.</p>
        <Link href="/productions" className="text-sm mt-2 block" style={{ color: "var(--color-accent)" }}>← Back to Productions</Link>
      </div>
    );
  }

  const pct = castTotal > 0 ? Math.round((consentedCount / castTotal) * 100) : 0;
  const circumference = 2 * Math.PI * 28;

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-2">
        <Link href="/productions" className="text-xs" style={{ color: "var(--color-muted)" }}>← Productions</Link>
      </div>
      <div className="flex flex-col sm:flex-row items-start sm:justify-between mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>{production.name}</h1>
            {production.type && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>
                {production.type.replace("_", " ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {(production.orgName ?? production.companyName) && (
              <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-muted)" }}>
                <span>{production.orgName ?? production.companyName}</span>
                <OrgTypeBadge type={production.orgType} />
              </span>
            )}
            {production.year && <span className="text-sm" style={{ color: "var(--color-muted)" }}>{production.year}</span>}
            {production.director && <span className="text-sm" style={{ color: "var(--color-muted)" }}>Dir. {production.director}</span>}
            {production.sagProjectNumber && (
              <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(124,58,237,0.1)", color: "#7c3aed" }}>
                SAG {production.sagProjectNumber}
              </span>
            )}
          </div>
        </div>

        {/* Compliance ring */}
        {castTotal > 0 && (
          <div className="flex items-center gap-3 self-start sm:shrink-0 rounded p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="var(--color-border)" strokeWidth="6" />
              <circle
                cx="32" cy="32" r="28"
                fill="none"
                stroke={pct === 100 ? "#166534" : "var(--color-accent)"}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - pct / 100)}
                transform="rotate(-90 32 32)"
              />
              <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--color-text)">{pct}%</text>
            </svg>
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--color-text)" }}>{consentedCount}/{castTotal} consented</p>
              {invitedCount > 0 && <p className="text-xs" style={{ color: "var(--color-muted)" }}>{invitedCount} pending invite</p>}
              {pct === 100 && (
                <Link href={`/compliance/dashboard`} className="text-xs mt-1 block" style={{ color: "var(--color-accent)" }}>
                  Generate Certificate →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Cast list */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Cast · {castTotal} member{castTotal !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setShowAddPanel((v) => !v)}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: "var(--color-accent)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Cast
        </button>
      </div>

      {/* Add cast panel */}
      {showAddPanel && (
        <div className="rounded p-5 mb-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--color-muted)" }}>Add Cast Members</p>

          {/* Tabs */}
          <div className="flex gap-1 mb-5 rounded p-1" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", width: "fit-content" }}>
            {(["manual", "tmdb", "csv"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setAddTab(tab)}
                className="rounded px-3 py-1 text-xs font-medium transition"
                style={{
                  background: addTab === tab ? "var(--color-accent)" : "transparent",
                  color: addTab === tab ? "white" : "var(--color-muted)",
                }}
              >
                {tab === "tmdb" ? "TMDB Import" : tab === "csv" ? "CSV Upload" : "Manual Entry"}
              </button>
            ))}
          </div>

          {/* TMDB tab */}
          {addTab === "tmdb" && (
            <div className="space-y-3">
              {!tmdbFetched ? (
                <div>
                  <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                    Import cast from TMDB credits. Matched talent will be pre-ticked. You must supply emails for unmatched members.
                  </p>
                  <button
                    onClick={fetchTmdbCast}
                    disabled={tmdbLoading}
                    className="rounded px-4 py-2 text-sm font-medium text-white"
                    style={{ background: tmdbLoading ? "var(--color-muted)" : "var(--color-accent)", cursor: tmdbLoading ? "not-allowed" : "pointer" }}
                  >
                    {tmdbLoading ? "Fetching credits…" : "Fetch TMDB Credits"}
                  </button>
                </div>
              ) : tmdbCast.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                    No TMDB credits found for this production. Search for the correct title to try again.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tmdbSearchQ}
                      onChange={(e) => setTmdbSearchQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void searchTmdbTitles(); }}
                      placeholder="Search TMDB title…"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      onClick={() => void searchTmdbTitles()}
                      disabled={tmdbSearching || !tmdbSearchQ.trim()}
                      className="rounded px-3 py-1.5 text-xs font-medium text-white shrink-0"
                      style={{ background: tmdbSearching || !tmdbSearchQ.trim() ? "var(--color-muted)" : "var(--color-accent)", cursor: tmdbSearching ? "not-allowed" : "pointer" }}
                    >
                      {tmdbSearching ? "Searching…" : "Search"}
                    </button>
                  </div>
                  {tmdbSearchResults.length > 0 && (
                    <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                      {tmdbSearchResults.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => void selectTmdbTitle(r.id)}
                          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b last:border-0"
                          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
                        >
                          <span className="font-medium">{r.title}</span>
                          <span className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>
                            {r.mediaType === "tv" ? "TV" : "Film"}{r.year ? ` · ${r.year}` : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {tmdbCast.map((m) => (
                    <label key={m.tmdbId} className="flex items-center gap-3 rounded p-2.5 cursor-pointer" style={{ border: "1px solid var(--color-border)", background: tmdbSelected.has(m.tmdbId) ? "rgba(192,57,43,0.04)" : "transparent" }}>
                      <input
                        type="checkbox"
                        checked={tmdbSelected.has(m.tmdbId)}
                        onChange={(e) => {
                          const s = new Set(tmdbSelected);
                          if (e.target.checked) { s.add(m.tmdbId); } else { s.delete(m.tmdbId); }
                          setTmdbSelected(s);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{m.name}</span>
                        {m.character && <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>as {m.character}</span>}
                        {m.matched && <span className="text-xs ml-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>Matched</span>}
                      </div>
                      {!m.matched && tmdbSelected.has(m.tmdbId) && (
                        <input
                          type="email"
                          placeholder="Email address"
                          value={tmdbEmails[m.tmdbId] ?? ""}
                          onChange={(e) => setTmdbEmails((prev) => ({ ...prev, [m.tmdbId]: e.target.value }))}
                          onClick={(e) => e.preventDefault()}
                          style={{ ...inputStyle, width: 200 }}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Manual tab */}
          {addTab === "manual" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Email *</label>
                  <input type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} style={inputStyle} placeholder="actor@example.com" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Character Name</label>
                  <input type="text" value={manualCharacter} onChange={(e) => setManualCharacter(e.target.value)} style={inputStyle} placeholder="e.g. Elizabeth I" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Department</label>
                  <input type="text" value={manualDept} onChange={(e) => setManualDept(e.target.value)} style={inputStyle} placeholder="e.g. Principal, VFX" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={manualSag} onChange={(e) => setManualSag(e.target.checked)} />
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>SAG-AFTRA member</span>
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={addToQueue}
                className="rounded px-3 py-1.5 text-xs font-medium"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              >
                + Add to list
              </button>
              {manualQueue.length > 0 && (
                <div className="rounded p-3 space-y-1.5" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  {manualQueue.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs" style={{ color: "var(--color-text)" }}>
                      <span>{m.email}{m.characterName && ` — ${m.characterName}`}</span>
                      <button onClick={() => setManualQueue((q) => q.filter((_, j) => j !== i))} style={{ color: "var(--color-muted)" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CSV tab */}
          {addTab === "csv" && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                CSV format: <code className="font-mono">email,sag_member,character_name,department</code> (header row skipped)
              </p>
              <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="text-sm" style={{ color: "var(--color-text)" }} />
              {csvError && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{csvError}</p>}
              {csvRows.length > 0 && (
                <p className="text-xs" style={{ color: "#166534" }}>{csvRows.length} rows loaded.</p>
              )}
            </div>
          )}

          {/* Licence terms — shared across all members in this batch */}
          <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--color-border)" }}>
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Licence Terms</p>
            <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
              These terms apply to all members in this batch. Terms copy forward from your previous entry.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Intended Use *</label>
                <input type="text" value={terms.intendedUse} onChange={(e) => setTerms((t) => ({ ...t, intendedUse: e.target.value }))} style={inputStyle} placeholder="e.g. Digital double for VFX sequences" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Valid From *</label>
                <input type="date" value={terms.validFrom} onChange={(e) => setTerms((t) => ({ ...t, validFrom: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Valid To *</label>
                <input type="date" value={terms.validTo} onChange={(e) => setTerms((t) => ({ ...t, validTo: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Licence Type</label>
                <select value={terms.licenceType} onChange={(e) => setTerms((t) => ({ ...t, licenceType: e.target.value }))} style={{ ...inputStyle }}>
                  {LICENCE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Exclusivity</label>
                <select value={terms.exclusivity} onChange={(e) => setTerms((t) => ({ ...t, exclusivity: e.target.value }))} style={{ ...inputStyle }}>
                  {EXCLUSIVITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Territory</label>
                <select value={terms.territory} onChange={(e) => setTerms((t) => ({ ...t, territory: e.target.value }))} style={{ ...inputStyle }}>
                  <option value="">Select territory…</option>
                  {TERRITORY_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Proposed Fee ($)</label>
                <input type="number" min={0} value={terms.proposedFee} onChange={(e) => setTerms((t) => ({ ...t, proposedFee: e.target.value }))} style={inputStyle} placeholder="0" />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input type="checkbox" id="aitraining" checked={terms.permitAiTraining} onChange={(e) => setTerms((t) => ({ ...t, permitAiTraining: e.target.checked }))} />
                <label htmlFor="aitraining" className="text-xs cursor-pointer" style={{ color: "var(--color-muted)" }}>Permit AI training use</label>
              </div>
            </div>
          </div>

          {submitError && (
            <p className="text-xs mt-3 rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>
              {submitError}
            </p>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded px-4 py-2 text-sm font-medium text-white"
              style={{ background: submitting ? "var(--color-muted)" : "var(--color-accent)", cursor: submitting ? "not-allowed" : "pointer" }}
            >
              {submitting ? "Adding…" : "Add Cast Members"}
            </button>
            <button onClick={() => setShowAddPanel(false)} className="text-sm" style={{ color: "var(--color-muted)" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Cast table */}
      {cast.length === 0 ? (
        <div className="rounded p-8 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>No cast members yet</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>Use the Add Cast button to import from TMDB, enter manually, or upload a CSV.</p>
        </div>
      ) : (
        <div className="rounded overflow-x-auto" style={{ border: "1px solid var(--color-border)" }}>
          <table className="w-full text-sm" style={{ minWidth: 700 }}>
            <thead>
              <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                {["Talent", "Character", "Dept", "SAG", "Status", "Licence", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium tracking-wider uppercase" style={{ color: "var(--color-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cast.map((row, i) => (
                <tr key={row.id} style={{ borderBottom: i < cast.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
                  <td className="px-4 py-3">
                    {row.talentProfile ? (
                      <div>
                        <span className="font-medium" style={{ color: "var(--color-text)" }}>{row.talentProfile.fullName}</span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>{row.invite?.email ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>{row.characterName ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>{row.department ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.sagMember ? (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>SAG</span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: `${CAST_STATUS_COLOUR[row.status] ?? "#6b7280"}18`,
                        color: CAST_STATUS_COLOUR[row.status] ?? "#6b7280",
                      }}
                    >
                      {CAST_STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.licence ? (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{
                          background: row.licence.status === "APPROVED" ? "rgba(22,101,52,0.1)" : row.licence.status === "DENIED" ? "rgba(153,27,27,0.1)" : "rgba(180,83,9,0.1)",
                          color: row.licence.status === "APPROVED" ? "#166534" : row.licence.status === "DENIED" ? "#991b1b" : "#b45309",
                        }}
                      >
                        {row.licence.status}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.status === "invited" && (
                        <button
                          onClick={() => handleResend(row.id)}
                          disabled={resendingId === row.id}
                          className="text-xs"
                          style={{ color: "var(--color-accent)" }}
                          title="Resend invite"
                        >
                          {resendingId === row.id ? "…" : "Resend"}
                        </button>
                      )}
                      {(row.status === "invited" || row.status === "linked") && (
                        <button
                          onClick={() => handleRemove(row.id)}
                          disabled={removingId === row.id}
                          className="text-xs"
                          style={{ color: "var(--color-muted)" }}
                          title="Remove cast member"
                        >
                          {removingId === row.id ? "…" : "Remove"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Licences */}
      {licences.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
            Licences · {licences.length}
          </p>
          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                  {["Talent", "Type", "Status", "Valid To", "Fee"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-medium tracking-wider uppercase" style={{ color: "var(--color-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {licences.map((lic, i) => {
                  const licColour: Record<string, string> = {
                    APPROVED: "#166534", PENDING: "#b45309", AWAITING_PACKAGE: "#7c3aed",
                    DENIED: "#991b1b", REVOKED: "#6b7280", EXPIRED: "#6b7280",
                  };
                  const colour = licColour[lic.status] ?? "#6b7280";
                  return (
                    <tr key={lic.id} style={{ borderBottom: i < licences.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
                      <td className="px-4 py-3">
                        <Link href={`/licences/${lic.id}`} style={{ color: "var(--color-accent)" }}>
                          <span className="text-sm font-medium">{lic.talentName ?? lic.talentEmail ?? "—"}</span>
                        </Link>
                        {lic.packageName && <span className="text-xs block" style={{ color: "var(--color-muted)" }}>{lic.packageName}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                          {lic.licenceType ? lic.licenceType.replace(/_/g, " ") : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${colour}18`, color: colour }}>
                          {lic.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                          {new Date(lic.validTo * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                          {lic.agreedFee ? `£${(lic.agreedFee / 100).toLocaleString()}` : lic.proposedFee ? `£${(lic.proposedFee / 100).toLocaleString()} proposed` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
