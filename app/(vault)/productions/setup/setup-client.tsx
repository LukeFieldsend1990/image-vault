"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import VendorsPanel from "@/app/(vault)/productions/[id]/vendors-panel";
import {
  COUNTRY_TOP_LEVEL,
  complianceStatement,
  hasSubPick,
  subPickList,
  subPickLabel,
} from "@/lib/jurisdictions/countries";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Organisation {
  id: string;
  name: string;
  orgType: string;
  memberRole: string;
}

interface TmdbTitle {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
}

interface MatchedCastMember {
  tmdbId: number;
  name: string;
  character: string;
  matched: boolean;
  talentId?: string;
  talentEmail?: string;
  profilePath?: string;
}

interface CastRow {
  id: string;
  tmdbId: number | null;
  status: string;
}

const PRODUCTION_TYPES = [
  { value: "film", label: "Film" },
  { value: "tv_series", label: "TV Series" },
  { value: "tv_movie", label: "TV Movie" },
  { value: "commercial", label: "Commercial" },
  { value: "game", label: "Game" },
  { value: "music_video", label: "Music Video" },
  { value: "other", label: "Other" },
];

const LICENCE_TYPES = [
  { value: "film_double", label: "Digital double · Film" },
  { value: "game_character", label: "Game character" },
  { value: "commercial", label: "Commercial" },
  { value: "ai_avatar", label: "AI avatar" },
  { value: "training_data", label: "Training data" },
  { value: "monitoring_reference", label: "Monitoring reference" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 14,
  color: "var(--color-text)",
  outline: "none",
};

const STEPS = ["Welcome", "Company", "Production", "Jurisdiction", "Cast", "Vendors", "Terms", "Done"];

// ── Small UI helpers ───────────────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{hint}</p>}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded px-5 py-2 text-sm font-medium text-white"
      style={{ background: disabled ? "var(--color-muted)" : "var(--color-accent)", cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded px-4 py-2 text-sm" style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="text-sm rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>
      {message}
    </p>
  );
}

function toUnix(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const ms = Date.parse(dateStr + "T00:00:00Z");
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

// ── Wizard ──────────────────────────────────────────────────────────────────────

export default function SetupClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Step 1 — company
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [orgMode, setOrgMode] = useState<"pick" | "create">("create");
  const [orgId, setOrgId] = useState("");
  const [orgForm, setOrgForm] = useState({ name: "", website: "", billingEmail: "" });

  // Step 2 — production
  const [tmdbQuery, setTmdbQuery] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbTitle[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const tmdbTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [prodForm, setProdForm] = useState({
    name: "", type: "film", year: new Date().getFullYear(),
    tmdbId: null as number | null, sagProjectNumber: "", isSag: false, isEquity: false,
  });
  const [productionId, setProductionId] = useState("");

  // Step 3 — jurisdiction (home country). Two-level pick mirrors the design
  // prototype: top-level regime, then EU country or US state if applicable.
  const [jurStep, setJurStep] = useState<"pick" | "sub" | "confirm">("pick");
  const [jurTopLevel, setJurTopLevel] = useState<string | null>(null);
  const [jurSub, setJurSub] = useState<string | null>(null);
  const [jurSearch, setJurSearch] = useState("");

  // Step 4 — cast
  const [tmdbCast, setTmdbCast] = useState<MatchedCastMember[]>([]);
  const [castLoading, setCastLoading] = useState(false);
  const [castNote, setCastNote] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ imported: number; matched: number } | null>(null);

  // Step 6 — default terms
  const [terms, setTerms] = useState({
    intendedUse: "", licenceType: "film_double", territory: "Worldwide",
    exclusivity: "non_exclusive", permitAiTraining: false, validFrom: "", validTo: "", feePounds: "",
  });

  // Step 7 — done
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);

  // Load eligible orgs once (owner/admin → can create productions).
  useEffect(() => {
    fetch("/api/organisations")
      .then((r) => r.json() as Promise<{ organisations?: Organisation[] }>)
      .then((d) => {
        const eligible = (d.organisations ?? []).filter((o) => o.memberRole === "owner" || o.memberRole === "admin");
        setOrgs(eligible);
        if (eligible.length > 0) { setOrgMode("pick"); setOrgId(eligible[0].id); }
      })
      .catch(() => {});
  }, []);

  // ── Step 1: company ──
  async function submitCompany() {
    setError("");
    if (orgMode === "pick") {
      if (!orgId) { setError("Select a company or create a new one."); return; }
      setStep(2);
      return;
    }
    if (!orgForm.name.trim()) { setError("Company name is required."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgForm.name.trim(),
          website: orgForm.website.trim() || undefined,
          billingEmail: orgForm.billingEmail.trim() || undefined,
          orgType: "production_company",
        }),
      });
      const d = await r.json() as { organisationId?: string; error?: string };
      if (!r.ok || !d.organisationId) { setError(d.error ?? "Failed to create company."); return; }
      setOrgId(d.organisationId);
      setStep(2);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: production search ──
  function handleTmdbSearch(q: string) {
    setTmdbQuery(q);
    if (tmdbTimeout.current) clearTimeout(tmdbTimeout.current);
    if (q.trim().length < 2) { setTmdbResults([]); return; }
    tmdbTimeout.current = setTimeout(async () => {
      setTmdbSearching(true);
      try {
        const r = await fetch(`/api/productions/tmdb-search?q=${encodeURIComponent(q)}`);
        const d = await r.json() as { results?: TmdbTitle[] };
        setTmdbResults((d.results ?? []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8));
      } catch {
        setTmdbResults([]);
      } finally {
        setTmdbSearching(false);
      }
    }, 350);
  }

  function selectTitle(t: TmdbTitle) {
    const title = t.title ?? t.name ?? "";
    const year = parseInt((t.release_date ?? t.first_air_date ?? "").split("-")[0]) || new Date().getFullYear();
    const type = t.media_type === "tv" ? "tv_series" : "film";
    setProdForm((f) => ({ ...f, name: title, year, type, tmdbId: t.id }));
    setTmdbResults([]);
    setTmdbQuery("");
    setManualMode(true); // reveal the editable detail fields
  }

  // Production details are captured at step 2 but the production isn't created
  // until home jurisdiction has been confirmed at step 3 — homeCountry has to
  // be set when the row is inserted so production_countries gets seeded with
  // is_home=1 in one transactional step.
  function continueFromProduction() {
    setError("");
    if (!prodForm.name.trim()) { setError("Production name is required."); return; }
    if (!orgId) { setError("Missing company — go back a step."); return; }
    setStep(3);
  }

  async function confirmJurisdiction() {
    setError("");
    if (!jurTopLevel || !jurSub) { setError("Pick a country to continue."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: prodForm.name.trim(),
          organisationId: orgId,
          type: prodForm.type,
          year: prodForm.year || undefined,
          tmdbId: prodForm.tmdbId ?? undefined,
          sagProjectNumber: prodForm.sagProjectNumber.trim() || undefined,
          isSag: prodForm.isSag || undefined,
          isEquity: prodForm.isEquity || undefined,
          status: "pre_production",
          homeCountry: { name: jurSub, topLevelId: jurTopLevel },
        }),
      });
      const d = await r.json() as { id?: string; error?: string };
      if (!r.ok || !d.id) { setError(d.error ?? "Failed to create production."); return; }
      setProductionId(d.id);
      setStep(4);
      void loadCast(d.id);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 3: cast ──
  async function loadCast(pid: string) {
    if (!prodForm.tmdbId) {
      setCastNote("This production isn't linked to TMDB, so there's no cast to auto-import. You can add cast by name or CSV from the production page after setup.");
      return;
    }
    setCastLoading(true);
    setCastNote("");
    try {
      const r = await fetch(`/api/productions/${pid}/cast/tmdb`);
      const d = await r.json() as { cast?: MatchedCastMember[]; error?: string };
      if (!r.ok) { setCastNote(d.error ?? "Couldn't load the TMDB cast list."); return; }
      const cast = d.cast ?? [];
      setTmdbCast(cast);
      setSelected(new Set(cast.map((c) => c.tmdbId))); // all selected by default
    } catch {
      setCastNote("Couldn't reach TMDB. You can import cast later from the production page.");
    } finally {
      setCastLoading(false);
    }
  }

  function toggleMember(tmdbId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId); else next.add(tmdbId);
      return next;
    });
  }

  async function importCast() {
    setError("");
    if (selected.size === 0) { setStep(5); return; } // nothing to import — skip ahead
    setBusy(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/cast/tmdb/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbIds: Array.from(selected) }),
      });
      const d = await r.json() as { imported?: number; matched?: number; error?: string };
      if (!r.ok) { setError(d.error ?? "Failed to import cast."); return; }
      setImportResult({ imported: d.imported ?? 0, matched: d.matched ?? 0 });
      setStep(5);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 4: default terms ──
  async function submitTerms() {
    setError("");
    const validFrom = toUnix(terms.validFrom);
    const validTo = toUnix(terms.validTo);
    if (validFrom && validTo && validTo <= validFrom) { setError("End date must be after start date."); return; }
    setBusy(true);
    try {
      const feePence = terms.feePounds.trim() ? Math.round(parseFloat(terms.feePounds) * 100) : undefined;
      const r = await fetch(`/api/productions/${productionId}/default-terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intendedUse: terms.intendedUse.trim() || undefined,
          licenceType: terms.licenceType,
          territory: terms.territory.trim() || undefined,
          exclusivity: terms.exclusivity,
          permitAiTraining: terms.permitAiTraining,
          validFrom, validTo,
          proposedFee: Number.isFinite(feePence) ? feePence : undefined,
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) { setError(d.error ?? "Failed to save terms."); return; }
      setStep(7);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Step 5: batch-send licence requests to matched cast ──
  const matchedCount = tmdbCast.filter((c) => c.matched && selected.has(c.tmdbId)).length;

  async function sendMatchedRequests() {
    setError("");
    setBusy(true);
    try {
      // Map tmdbId → talentEmail for matched, selected members.
      const emailByTmdb = new Map<number, string>();
      for (const c of tmdbCast) {
        if (c.matched && c.talentEmail && selected.has(c.tmdbId)) emailByTmdb.set(c.tmdbId, c.talentEmail);
      }
      // Fetch the real cast rows to get castIds for those tmdbIds.
      const cr = await fetch(`/api/productions/${productionId}/cast`);
      const cd = await cr.json() as { cast?: CastRow[] };
      const rows = cd.cast ?? [];
      let sent = 0, failed = 0;
      for (const row of rows) {
        if (row.status !== "placeholder" || row.tmdbId === null) continue;
        const email = emailByTmdb.get(row.tmdbId);
        if (!email) continue;
        const rr = await fetch(`/api/productions/${productionId}/cast/${row.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (rr.ok) sent++; else failed++;
      }
      setSendResult({ sent, failed });
    } catch {
      setError("Network error sending requests.");
    } finally {
      setBusy(false);
    }
  }

  // ── Render ──
  return (
    <div className="p-8 max-w-2xl">
      {/* Stepper */}
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-accent)" }}>
          Set up your production
        </p>
        <div className="flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5 flex-1 last:flex-none">
              <span
                className="h-1.5 rounded-full flex-1 transition-colors"
                style={{ background: i <= step ? "var(--color-accent)" : "var(--color-border)", minWidth: 18 }}
                title={label}
              />
            </div>
          ))}
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
          Step {step} of {STEPS.length - 1} · {STEPS[step]}
        </p>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {/* Step 0 — Welcome */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
              Let&apos;s set up your first production
            </h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
              You&apos;ll have your full cast roster on screen in a few minutes — <strong style={{ color: "var(--color-text)" }}>no need to track down anyone&apos;s email first.</strong> We pull the cast from public data and let the rest fill in over time as talent join Image Vault.
            </p>
          </div>
          <ul className="space-y-2 text-sm" style={{ color: "var(--color-muted)" }}>
            <li>· Name your company</li>
            <li>· Find your production (we&apos;ll pull the cast for you)</li>
            <li>· Reserve roles — invite who you can reach, leave the rest</li>
            <li>· Set your licence terms once, not per actor</li>
          </ul>
          <PrimaryButton onClick={() => setStep(1)}>Get started</PrimaryButton>
        </div>
      )}

      {/* Step 1 — Company */}
      {step === 1 && (
        <div className="space-y-5">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Your company</h1>

          {orgs.length > 0 && (
            <div className="flex gap-2 text-sm">
              <button
                type="button" onClick={() => setOrgMode("pick")}
                className="rounded px-3 py-1.5"
                style={{ background: orgMode === "pick" ? "rgba(192,57,43,0.1)" : "transparent", color: orgMode === "pick" ? "var(--color-accent)" : "var(--color-muted)", border: "1px solid var(--color-border)" }}
              >Use existing</button>
              <button
                type="button" onClick={() => setOrgMode("create")}
                className="rounded px-3 py-1.5"
                style={{ background: orgMode === "create" ? "rgba(192,57,43,0.1)" : "transparent", color: orgMode === "create" ? "var(--color-accent)" : "var(--color-muted)", border: "1px solid var(--color-border)" }}
              >Create new</button>
            </div>
          )}

          {orgMode === "pick" && orgs.length > 0 ? (
            <Field label="Company">
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} style={inputStyle}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Company name *">
                <input type="text" value={orgForm.name} onChange={(e) => setOrgForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Left Bank Pictures" style={inputStyle} />
              </Field>
              <details>
                <summary className="text-xs cursor-pointer" style={{ color: "var(--color-muted)" }}>Optional details</summary>
                <div className="space-y-4 mt-3">
                  <Field label="Website"><input type="text" value={orgForm.website} onChange={(e) => setOrgForm((f) => ({ ...f, website: e.target.value }))} style={inputStyle} /></Field>
                  <Field label="Billing email"><input type="email" value={orgForm.billingEmail} onChange={(e) => setOrgForm((f) => ({ ...f, billingEmail: e.target.value }))} style={inputStyle} /></Field>
                </div>
              </details>
            </>
          )}

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={submitCompany} disabled={busy}>{busy ? "Saving…" : "Continue"}</PrimaryButton>
            <GhostButton onClick={() => setStep(0)}>Back</GhostButton>
          </div>
        </div>
      )}

      {/* Step 2 — Production */}
      {step === 2 && (
        <div className="space-y-5">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Find your production</h1>

          {!manualMode && (
            <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <div className="relative">
                <input type="text" placeholder="What are you working on?" value={tmdbQuery} onChange={(e) => handleTmdbSearch(e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
                {tmdbSearching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--color-muted)" }}>…</span>}
                {tmdbResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 rounded shadow-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                    {tmdbResults.map((r) => (
                      <button key={r.id} type="button" onClick={() => selectTitle(r)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                        <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>{r.media_type === "tv" ? "TV" : "Film"}</span>
                        {r.title ?? r.name}
                        {(r.release_date ?? r.first_air_date) && <span className="text-xs ml-auto" style={{ color: "var(--color-muted)" }}>{(r.release_date ?? r.first_air_date ?? "").slice(0, 4)}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => { setManualMode(true); setProdForm((f) => ({ ...f, tmdbId: null })); }} className="text-xs mt-3" style={{ color: "var(--color-accent)" }}>
                It&apos;s not listed / it&apos;s unannounced →
              </button>
            </div>
          )}

          {manualMode && (
            <div className="space-y-4">
              {prodForm.tmdbId && (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Linked to TMDB #{prodForm.tmdbId} — we&apos;ll pull the cast next.{" "}
                  <button type="button" onClick={() => { setManualMode(false); setProdForm((f) => ({ ...f, tmdbId: null, name: "" })); }} style={{ color: "var(--color-accent)" }}>Change</button>
                </p>
              )}
              <Field label="Production name *">
                <input type="text" value={prodForm.name} onChange={(e) => setProdForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Project Northwind" style={inputStyle} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Type">
                  <select value={prodForm.type} onChange={(e) => setProdForm((f) => ({ ...f, type: e.target.value }))} style={inputStyle}>
                    {PRODUCTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Year">
                  <input type="number" value={prodForm.year} onChange={(e) => setProdForm((f) => ({ ...f, year: parseInt(e.target.value) || new Date().getFullYear() }))} min={1900} max={2100} style={inputStyle} />
                </Field>
              </div>
              <Field label="Union project number" hint="Optional — we'll stamp it on every consent record for your Article 39 filings.">
                <input type="text" value={prodForm.sagProjectNumber} onChange={(e) => setProdForm((f) => ({ ...f, sagProjectNumber: e.target.value }))} placeholder="e.g. 24-FS-0123" style={inputStyle} />
              </Field>
              <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Union affiliation</p>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={prodForm.isSag} onChange={(e) => setProdForm((f) => ({ ...f, isSag: e.target.checked }))} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
                    <span className="text-sm" style={{ color: "var(--color-text)" }}>SAG-AFTRA</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={prodForm.isEquity} onChange={(e) => setProdForm((f) => ({ ...f, isEquity: e.target.checked }))} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
                    <span className="text-sm" style={{ color: "var(--color-text)" }}>Equity</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={continueFromProduction} disabled={!prodForm.name.trim()}>Continue</PrimaryButton>
            <GhostButton onClick={() => setStep(1)}>Back</GhostButton>
          </div>
        </div>
      )}

      {/* Step 3 — Jurisdiction (home country) */}
      {step === 3 && (
        <div className="space-y-5">
          {jurStep === "pick" && (
            <>
              <div>
                <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Where is the production registered?</h1>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                  The country your production company is registered in, not where the shoot happens. Shoot locations come later. This sets the home jurisdiction for performer data.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {COUNTRY_TOP_LEVEL.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setJurTopLevel(c.id);
                      if (hasSubPick(c.id)) {
                        setJurSub(null);
                        setJurSearch("");
                        setJurStep("sub");
                      } else {
                        setJurSub(c.label);
                        setJurStep("confirm");
                      }
                    }}
                    className="text-left rounded p-4"
                    style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{c.sub}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <GhostButton onClick={() => setStep(2)}>Back</GhostButton>
              </div>
            </>
          )}

          {jurStep === "sub" && jurTopLevel && (
            <>
              <div>
                <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Which {subPickLabel(jurTopLevel)}?</h1>
                <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>Pick one — you can add more from the production page later.</p>
              </div>
              <input
                type="text"
                placeholder="Search"
                value={jurSearch}
                onChange={(e) => setJurSearch(e.target.value)}
                style={{ ...inputStyle, maxWidth: 360 }}
                autoComplete="off"
              />
              <div className="grid sm:grid-cols-2 gap-2">
                {subPickList(jurTopLevel)
                  .filter((c) => !jurSearch.trim() || c.toLowerCase().includes(jurSearch.toLowerCase().trim()))
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setJurSub(c); setJurStep("confirm"); }}
                      className="text-left rounded px-4 py-3"
                      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c}</span>
                    </button>
                  ))}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <GhostButton onClick={() => { setJurStep("pick"); setJurSearch(""); }}>Back</GhostButton>
              </div>
            </>
          )}

          {jurStep === "confirm" && jurTopLevel && jurSub && (
            <>
              <div>
                <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Confirm {jurSub} as the home country</h1>
                <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>Please read this before confirming.</p>
              </div>
              <div className="rounded p-4" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>Home country</p>
                <p className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>{jurSub}</p>
              </div>
              <div className="rounded p-4" style={{ background: "rgba(192,57,43,0.04)", border: "1px solid rgba(192,57,43,0.15)" }}>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                  {complianceStatement(jurTopLevel, jurSub)}
                </p>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <PrimaryButton onClick={confirmJurisdiction} disabled={busy}>{busy ? "Creating…" : `Confirm and add ${jurSub}`}</PrimaryButton>
                <GhostButton onClick={() => setJurStep(hasSubPick(jurTopLevel) ? "sub" : "pick")}>Back</GhostButton>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4 — Cast */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Your cast</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
              Pulled from public credits. Deselect anyone you don&apos;t need rights for. We&apos;ll reserve a role for each — emails are never required here.
            </p>
          </div>

          {castLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="rounded animate-pulse" style={{ height: 44, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />)}
            </div>
          )}

          {castNote && !castLoading && (
            <p className="text-sm rounded px-3 py-3" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}>{castNote}</p>
          )}

          {!castLoading && tmdbCast.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-muted)" }}>
                <span>{selected.size} of {tmdbCast.length} selected · {tmdbCast.filter((c) => c.matched).length} already on Image Vault</span>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setSelected(new Set(tmdbCast.map((c) => c.tmdbId)))} style={{ color: "var(--color-accent)" }}>Select all</button>
                  <button type="button" onClick={() => setSelected(new Set())} style={{ color: "var(--color-accent)" }}>Clear</button>
                </div>
              </div>
              <div className="rounded overflow-hidden divide-y" style={{ border: "1px solid var(--color-border)", borderColor: "var(--color-border)" }}>
                {tmdbCast.map((c) => (
                  <label key={c.tmdbId} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer" style={{ background: "var(--color-surface)" }}>
                    <input type="checkbox" checked={selected.has(c.tmdbId)} onChange={() => toggleMember(c.tmdbId)} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.name}</span>
                      {c.character && <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>as {c.character}</span>}
                    </div>
                    {c.matched ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>On Image Vault</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded shrink-0" style={{ background: "var(--color-bg)", color: "var(--color-muted)" }}>Reserved</span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={importCast} disabled={busy}>
              {busy ? "Reserving…" : selected.size > 0 ? `Reserve ${selected.size} role${selected.size === 1 ? "" : "s"}` : "Skip for now"}
            </PrimaryButton>
            <GhostButton onClick={() => setStep(3)}>Back</GhostButton>
          </div>
        </div>
      )}

      {/* Step 5 — Vendors */}
      {step === 5 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Vendors on this production</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
              Add the VFX, dubbing or scan vendors working on this production — optional, and you can do it later. Attaching a vendor lists them here; scan access is granted per licence and needs their environment audit to pass.
            </p>
          </div>

          {productionId && <VendorsPanel productionId={productionId} embedded />}

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={() => setStep(6)}>Continue</PrimaryButton>
            <GhostButton onClick={() => setStep(4)}>Back</GhostButton>
          </div>
        </div>
      )}

      {/* Step 6 — Default terms */}
      {step === 6 && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Set your default terms</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
              Set licence terms <strong style={{ color: "var(--color-text)" }}>once</strong> for the whole cast. You can override per actor later. Everything here is optional.
            </p>
          </div>
          <Field label="Intended use">
            <input type="text" value={terms.intendedUse} onChange={(e) => setTerms((t) => ({ ...t, intendedUse: e.target.value }))} placeholder="e.g. Digital double for VFX" style={inputStyle} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Licence type">
              <select value={terms.licenceType} onChange={(e) => setTerms((t) => ({ ...t, licenceType: e.target.value }))} style={inputStyle}>
                {LICENCE_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Territory">
              <input type="text" value={terms.territory} onChange={(e) => setTerms((t) => ({ ...t, territory: e.target.value }))} style={inputStyle} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valid from"><input type="date" value={terms.validFrom} onChange={(e) => setTerms((t) => ({ ...t, validFrom: e.target.value }))} style={inputStyle} /></Field>
            <Field label="Valid to"><input type="date" value={terms.validTo} onChange={(e) => setTerms((t) => ({ ...t, validTo: e.target.value }))} style={inputStyle} /></Field>
          </div>
          <Field label="Proposed fee per actor (£)" hint="Optional — leave blank to negotiate individually.">
            <input type="number" min={0} step="0.01" value={terms.feePounds} onChange={(e) => setTerms((t) => ({ ...t, feePounds: e.target.value }))} style={inputStyle} />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={terms.permitAiTraining} onChange={(e) => setTerms((t) => ({ ...t, permitAiTraining: e.target.checked }))} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
            <span className="text-sm" style={{ color: "var(--color-text)" }}>Permit AI training on this likeness</span>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <PrimaryButton onClick={submitTerms} disabled={busy}>{busy ? "Saving…" : "Continue"}</PrimaryButton>
            <GhostButton onClick={() => setStep(7)}>Skip</GhostButton>
          </div>
        </div>
      )}

      {/* Step 7 — Done */}
      {step === 7 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>{prodForm.name || "Your production"} is set up 🎬</h1>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
              {importResult ? (
                <>You reserved <strong style={{ color: "var(--color-text)" }}>{importResult.imported} role{importResult.imported === 1 ? "" : "s"}</strong>
                  {importResult.matched > 0 && <> — <strong style={{ color: "var(--color-text)" }}>{importResult.matched}</strong> {importResult.matched === 1 ? "is" : "are"} already on Image Vault and ready to license</>}.
                  {" "}We&apos;ll let you know the moment a reserved performer joins.</>
              ) : (
                <>Your production is ready. Add cast any time from the production page — by name, CSV, or TMDB.</>
              )}
            </p>
          </div>

          {matchedCount > 0 && !sendResult && (
            <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
                {matchedCount} cast member{matchedCount === 1 ? " is" : "s are"} ready to license now
              </p>
              <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>Send them a licence request using your default terms.</p>
              <PrimaryButton onClick={sendMatchedRequests} disabled={busy}>{busy ? "Sending…" : `Send ${matchedCount} licence request${matchedCount === 1 ? "" : "s"}`}</PrimaryButton>
            </div>
          )}

          {sendResult && (
            <p className="text-sm rounded px-3 py-3" style={{ background: "rgba(22,101,52,0.08)", border: "1px solid rgba(22,101,52,0.2)", color: "#166534" }}>
              Sent {sendResult.sent} licence request{sendResult.sent === 1 ? "" : "s"}.{sendResult.failed > 0 && ` ${sendResult.failed} couldn't be sent — review them on the production page.`}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button onClick={() => router.push(`/productions/${productionId}`)} className="rounded px-5 py-2 text-sm font-medium text-white" style={{ background: "var(--color-accent)" }}>
              Go to production
            </button>
            <Link href="/organisations" className="rounded px-4 py-2 text-sm" style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>
              Invite my team
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
