"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";

interface TmdbTitle {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
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

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--color-bg)", border: "1px solid var(--color-border)",
  borderRadius: 6, padding: "8px 12px", fontSize: 14, color: "var(--color-text)", outline: "none",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{hint}</p>}
    </div>
  );
}

function toUnix(d: string): number | undefined {
  if (!d) return undefined;
  const ms = Date.parse(d + "T00:00:00Z");
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

export default function ConciergeClient() {
  const [companyName, setCompanyName] = useState("");
  const [inviteeEmail, setInviteeEmail] = useState("");

  const [tmdbQuery, setTmdbQuery] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbTitle[]>([]);
  const tmdbTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prod, setProd] = useState({
    name: "", type: "film", year: new Date().getFullYear(),
    tmdbId: null as number | null, sagProjectNumber: "", isSag: false, isEquity: false, otherUnion: "",
  });
  const [showOtherUnion, setShowOtherUnion] = useState(false);
  const [importCast, setImportCast] = useState(true);

  const [termsOpen, setTermsOpen] = useState(false);
  const [terms, setTerms] = useState({
    intendedUse: "",
    useCategoryIds: ["vfx-this"] as string[],
    territory: "Worldwide",
    exclusivity: "non_exclusive",
    permitAiTraining: false,
    validFrom: "",
    validTo: "",
    feePounds: "",
    feeNA: false,
    isRelicense: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ productionId: string; castCount: number; email: string } | null>(null);

  function searchTmdb(q: string) {
    setTmdbQuery(q);
    if (tmdbTimeout.current) clearTimeout(tmdbTimeout.current);
    if (q.trim().length < 2) { setTmdbResults([]); return; }
    tmdbTimeout.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/productions/tmdb-search?q=${encodeURIComponent(q)}`);
        const d = await r.json() as { results?: TmdbTitle[] };
        setTmdbResults((d.results ?? []).filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8));
      } catch {
        setTmdbResults([]);
      }
    }, 300);
  }

  function pickTitle(t: TmdbTitle) {
    const title = t.title ?? t.name ?? "";
    const year = parseInt((t.release_date ?? t.first_air_date ?? "").split("-")[0]) || new Date().getFullYear();
    setProd((p) => ({ ...p, name: p.name || title, year, type: t.media_type === "tv" ? "tv_series" : "film", tmdbId: t.id }));
    setTmdbResults([]); setTmdbQuery("");
  }

  async function submit() {
    setError("");
    if (!companyName.trim()) { setError("Company name is required."); return; }
    if (!inviteeEmail.trim().includes("@")) { setError("A valid invitee email is required."); return; }
    if (!prod.name.trim()) { setError("Production name is required."); return; }
    setSubmitting(true);
    try {
      const validFrom = toUnix(terms.validFrom);
      const validTo = toUnix(terms.validTo);
      if (termsOpen && validFrom && validTo && validTo <= validFrom) {
        setError("End date must be after start date.");
        setSubmitting(false);
        return;
      }
      const feePence = terms.feeNA
        ? null
        : (terms.feePounds.trim() ? Math.round(parseFloat(terms.feePounds) * 100) : undefined);
      const r = await fetch("/api/admin/productions/concierge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          inviteeEmail: inviteeEmail.trim(),
          production: {
            name: prod.name.trim(), type: prod.type, year: prod.year,
            tmdbId: prod.tmdbId ?? undefined,
            sagProjectNumber: prod.sagProjectNumber.trim() || undefined,
            isSag: prod.isSag || undefined, isEquity: prod.isEquity || undefined,
            otherUnion: showOtherUnion ? prod.otherUnion.trim() || undefined : undefined,
          },
          importCast: importCast && !!prod.tmdbId,
          defaultTerms: termsOpen ? {
            intendedUse: terms.intendedUse.trim() || undefined,
            useCategoryIds: terms.useCategoryIds,
            territory: terms.territory.trim() || undefined,
            exclusivity: terms.exclusivity,
            permitAiTraining: terms.permitAiTraining,
            isRelicense: terms.isRelicense,
            validFrom,
            validTo,
            proposedFee: feePence,
          } : undefined,
        }),
      });
      const d = await r.json() as { ok?: boolean; productionId?: string; castCount?: number; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? "Failed to set up production."); return; }
      setDone({ productionId: d.productionId!, castCount: d.castCount ?? 0, email: inviteeEmail.trim() });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-3" style={{ color: "var(--color-ink)" }}>Production set up & invite sent</h1>
        <p className="text-sm mb-2" style={{ color: "var(--color-muted)" }}>
          {prod.name} is ready{done.castCount > 0 ? ` with ${done.castCount} cast reserved` : ""}. An invite was sent to <strong style={{ color: "var(--color-text)" }}>{done.email}</strong> — they&apos;ll become the owner on signup.
        </p>
        <div className="flex items-center gap-3 mt-6">
          <Link href={`/productions/${done.productionId}`} className="rounded px-5 py-2 text-sm font-medium text-white" style={{ background: "var(--color-accent)" }}>View production</Link>
          <button onClick={() => { setDone(null); setCompanyName(""); setInviteeEmail(""); setProd({ name: "", type: "film", year: new Date().getFullYear(), tmdbId: null, sagProjectNumber: "", isSag: false, isEquity: false, otherUnion: "" }); setShowOtherUnion(false); }} className="rounded px-4 py-2 text-sm" style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>Set up another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin · Concierge setup</p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Set up & invite a production</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Pre-build the production, then invite the industry user — they arrive to a mostly-set-up project and become the owner on signup.
        </p>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company name *"><input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Left Bank Pictures" style={inputStyle} /></Field>
          <Field label="Invitee email *" hint="Becomes the owner on signup."><input type="email" value={inviteeEmail} onChange={(e) => setInviteeEmail(e.target.value)} placeholder="producer@company.com" style={inputStyle} /></Field>
        </div>

        {/* TMDB link */}
        <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Link to title (optional)</p>
          {prod.tmdbId ? (
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "var(--color-text)" }}>{prod.name} <span className="text-xs" style={{ color: "var(--color-muted)" }}>#{prod.tmdbId}</span></span>
              <button type="button" onClick={() => setProd((p) => ({ ...p, tmdbId: null }))} className="text-xs" style={{ color: "var(--color-accent)" }}>Remove</button>
            </div>
          ) : (
            <div className="relative">
              <input type="text" value={tmdbQuery} onChange={(e) => searchTmdb(e.target.value)} placeholder="Search by title…" style={inputStyle} />
              {tmdbResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 rounded shadow-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                  {tmdbResults.map((r) => (
                    <button key={r.id} type="button" onClick={() => pickTitle(r)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>{r.media_type === "tv" ? "TV" : "Film"}</span>
                      {r.title ?? r.name}
                      {(r.release_date ?? r.first_air_date) && <span className="text-xs ml-auto" style={{ color: "var(--color-muted)" }}>{(r.release_date ?? r.first_air_date ?? "").slice(0, 4)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {prod.tmdbId && (
            <label className="flex items-center gap-2 cursor-pointer select-none mt-3">
              <input type="checkbox" checked={importCast} onChange={(e) => setImportCast(e.target.checked)} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text)" }}>Import the cast as reserved placeholders</span>
            </label>
          )}
        </div>

        <Field label="Production name *"><input type="text" value={prod.name} onChange={(e) => setProd((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Project Northwind" style={inputStyle} /></Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select value={prod.type} onChange={(e) => setProd((p) => ({ ...p, type: e.target.value }))} style={inputStyle}>
              {PRODUCTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Year"><input type="number" value={prod.year} onChange={(e) => setProd((p) => ({ ...p, year: parseInt(e.target.value) || new Date().getFullYear() }))} min={1900} max={2100} style={inputStyle} /></Field>
        </div>

        <Field label="Union project number"><input type="text" value={prod.sagProjectNumber} onChange={(e) => setProd((p) => ({ ...p, sagProjectNumber: e.target.value }))} placeholder="e.g. 24-FS-0123" style={inputStyle} /></Field>
        <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Union affiliation</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "sag", label: "SAG-AFTRA", active: prod.isSag, toggle: () => setProd((p) => ({ ...p, isSag: !p.isSag })) },
              { key: "equity", label: "Equity", active: prod.isEquity, toggle: () => setProd((p) => ({ ...p, isEquity: !p.isEquity })) },
              { key: "other", label: "Other", active: showOtherUnion, toggle: () => setShowOtherUnion((v) => { if (v) setProd((p) => ({ ...p, otherUnion: "" })); return !v; }) },
            ].map((u) => (
              <button
                key={u.key}
                type="button"
                onClick={u.toggle}
                className="px-4 py-2 rounded text-sm font-medium border transition"
                style={{
                  borderColor: u.active ? "var(--color-accent)" : "var(--color-border)",
                  background: u.active ? "var(--color-accent)" : "transparent",
                  color: u.active ? "white" : "var(--color-muted)",
                }}
              >
                {u.label}
              </button>
            ))}
          </div>
          {showOtherUnion && (
            <input
              type="text"
              value={prod.otherUnion}
              onChange={(e) => setProd((p) => ({ ...p, otherUnion: e.target.value }))}
              placeholder="Union name"
              style={{ ...inputStyle, marginTop: 12 }}
            />
          )}
        </div>

        {/* Default terms */}
        <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={termsOpen} onChange={(e) => setTermsOpen(e.target.checked)} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>Set default licence terms</span>
          </label>
          {termsOpen && (
            <div className="space-y-4 mt-4">
              <Field label="Intended use"><input type="text" value={terms.intendedUse} onChange={(e) => setTerms((t) => ({ ...t, intendedUse: e.target.value }))} placeholder="e.g. Digital double for VFX" style={inputStyle} /></Field>
              <Field label="What access are you requesting?" hint="These pre-tick each performer's consent document. They can untick or add more.">
                <div className="space-y-2">
                  {USE_CATEGORIES.map((cat) => {
                    const active = terms.useCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setTerms((t) => {
                          const on = t.useCategoryIds.includes(cat.id);
                          const useCategoryIds = on ? t.useCategoryIds.filter((v) => v !== cat.id) : [...t.useCategoryIds, cat.id];
                          const permitAiTraining = cat.id === "training" ? !on : t.permitAiTraining;
                          return { ...t, useCategoryIds, permitAiTraining };
                        })}
                        className="w-full flex items-start gap-3 rounded p-3 text-left transition"
                        style={{ border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`, background: active ? "rgba(192,57,43,0.05)" : "var(--color-bg)" }}
                      >
                        <span className="mt-0.5 flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`, background: active ? "var(--color-accent)" : "transparent", color: "white", fontSize: 11, lineHeight: 1 }}>{active ? "✓" : ""}</span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{cat.name}</span>
                            {cat.regimeTag && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>{cat.regimeTag}</span>}
                            {cat.sensitive && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(180,83,9,0.1)", color: "#b45309" }}>sensitive</span>}
                          </span>
                          <span className="block text-xs mt-1" style={{ color: "var(--color-muted)" }}>{cat.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Territory"><input type="text" value={terms.territory} onChange={(e) => setTerms((t) => ({ ...t, territory: e.target.value }))} style={inputStyle} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Valid from">
                  <input
                    type="date"
                    value={terms.validFrom}
                    onChange={(e) => {
                      // Suggest an 18-month term when the start date is set.
                      const validFrom = e.target.value;
                      let validTo = terms.validTo;
                      if (validFrom) {
                        const d = new Date(validFrom + "T00:00:00");
                        if (!Number.isNaN(d.getTime())) { d.setMonth(d.getMonth() + 18); validTo = d.toISOString().slice(0, 10); }
                      }
                      setTerms((t) => ({ ...t, validFrom, validTo }));
                    }}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Valid to" hint="Suggested 18-month term — adjust as needed."><input type="date" value={terms.validTo} onChange={(e) => setTerms((t) => ({ ...t, validTo: e.target.value }))} style={inputStyle} /></Field>
              </div>
              <Field label="Proposed fee per actor (£)" hint="Optional — leave blank to negotiate individually, or mark N/A when scanning is part of production costs.">
                <input type="number" min={0} step="0.01" value={terms.feeNA ? "" : terms.feePounds} disabled={terms.feeNA} onChange={(e) => setTerms((t) => ({ ...t, feePounds: e.target.value }))} style={{ ...inputStyle, opacity: terms.feeNA ? 0.5 : 1 }} placeholder={terms.feeNA ? "N/A" : undefined} />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={terms.feeNA} onChange={(e) => setTerms((t) => ({ ...t, feeNA: e.target.checked }))} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
                <span className="text-sm" style={{ color: "var(--color-text)" }}>Fee N/A (scanning is part of production costs)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={terms.isRelicense} onChange={(e) => setTerms((t) => ({ ...t, isRelicense: e.target.checked, feeNA: e.target.checked ? false : t.feeNA }))} className="w-4 h-4" style={{ accentColor: "var(--color-accent)" }} />
                <span className="text-sm" style={{ color: "var(--color-text)" }}>This is a re-licence of an existing scan (a fee is expected)</span>
              </label>
            </div>
          )}
        </div>

        {error && <p className="text-sm rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={submit} disabled={submitting} className="rounded px-5 py-2 text-sm font-medium text-white" style={{ background: submitting ? "var(--color-muted)" : "var(--color-accent)", cursor: submitting ? "not-allowed" : "pointer" }}>
            {submitting ? "Setting up…" : "Set up & send invite"}
          </button>
          <Link href="/admin/productions" className="rounded px-4 py-2 text-sm" style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>Cancel</Link>
        </div>
      </div>
    </div>
  );
}
