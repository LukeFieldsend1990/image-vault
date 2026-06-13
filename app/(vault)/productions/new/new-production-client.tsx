"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ORG_TYPE_LABELS, isOrgType } from "@/lib/organisations/orgTypes";

interface Organisation {
  id: string;
  name: string;
  orgType: string;
  memberRole: string;
}

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  poster_path?: string;
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

const PRODUCTION_STATUSES = [
  { value: "development", label: "Development" },
  { value: "pre_production", label: "Pre-Production" },
  { value: "production", label: "In Production" },
  { value: "post_production", label: "Post-Production" },
  { value: "released", label: "Released" },
  { value: "cancelled", label: "Cancelled" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{hint}</p>}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 14,
  color: "var(--color-text)",
  outline: "none",
};

export default function NewProductionClient() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [form, setForm] = useState({
    name: "",
    organisationId: "",
    companyName: "",
    type: "film",
    status: "pre_production",
    year: new Date().getFullYear(),
    director: "",
    vfxSupervisor: "",
    sagProjectNumber: "",
    notes: "",
    tmdbId: null as number | null,
    imdbId: "",
  });
  const [tmdbQuery, setTmdbQuery] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [tmdbLinked, setTmdbLinked] = useState<TmdbResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const tmdbTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/organisations")
      .then((r) => r.json() as Promise<{ organisations?: Organisation[] }>)
      .then((d) => {
        const eligible = (d.organisations ?? []).filter(
          (o: Organisation) => o.memberRole === "owner" || o.memberRole === "admin"
        );
        setOrgs(eligible);
        if (eligible.length === 1) {
          setForm((f) => ({ ...f, organisationId: eligible[0].id }));
        }
      })
      .catch(() => {});
  }, []);

  function handleTmdbSearch(q: string) {
    setTmdbQuery(q);
    setTmdbLinked(null);
    if (tmdbTimeout.current) clearTimeout(tmdbTimeout.current);
    if (!q.trim() || q.trim().length < 2) { setTmdbResults([]); return; }
    tmdbTimeout.current = setTimeout(async () => {
      setTmdbSearching(true);
      try {
        const r = await fetch(`/api/productions/tmdb-search?q=${encodeURIComponent(q)}`);
        const d = await r.json() as { results?: TmdbResult[] };
        setTmdbResults((d.results ?? []).filter((x: TmdbResult) => x.media_type === "movie" || x.media_type === "tv").slice(0, 8));
      } catch {
        setTmdbResults([]);
      } finally {
        setTmdbSearching(false);
      }
    }, 350);
  }

  function selectTmdb(result: TmdbResult) {
    setTmdbLinked(result);
    setTmdbResults([]);
    const title = result.title ?? result.name ?? "";
    const year = parseInt((result.release_date ?? result.first_air_date ?? "").split("-")[0]) || new Date().getFullYear();
    const type = result.media_type === "tv" ? "tv_series" : "film";
    setForm((f) => ({ ...f, name: f.name || title, year, type, tmdbId: result.id }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Production name is required."); return; }
    if (!form.organisationId) { setError("Please select an organisation."); return; }
    setSubmitting(true);
    setError("");
    try {
      const r = await fetch("/api/productions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          organisationId: form.organisationId,
          companyName: form.companyName.trim() || undefined,
          type: form.type || undefined,
          status: form.status || undefined,
          year: form.year || undefined,
          director: form.director.trim() || undefined,
          vfxSupervisor: form.vfxSupervisor.trim() || undefined,
          sagProjectNumber: form.sagProjectNumber.trim() || undefined,
          notes: form.notes.trim() || undefined,
          tmdbId: form.tmdbId ?? undefined,
          imdbId: form.imdbId.trim() || undefined,
        }),
      });
      const d = await r.json() as { error?: string; id?: string };
      if (!r.ok) { setError(d.error ?? "Failed to create production."); return; }
      router.push(`/productions/${d.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>
          Productions
        </p>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>New Production</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* TMDB search */}
        <div className="rounded p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
            Link to TMDB (optional)
          </p>
          {tmdbLinked ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                  {tmdbLinked.title ?? tmdbLinked.name}
                </span>
                <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>
                  TMDB #{tmdbLinked.id}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { setTmdbLinked(null); setForm((f) => ({ ...f, tmdbId: null })); }}
                className="text-xs"
                style={{ color: "var(--color-accent)" }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                placeholder="Search by title…"
                value={tmdbQuery}
                onChange={(e) => handleTmdbSearch(e.target.value)}
                style={{ ...inputStyle, paddingRight: 36 }}
              />
              {tmdbSearching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--color-muted)" }}>…</span>
              )}
              {tmdbResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 rounded shadow-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                  {tmdbResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => selectTmdb(r)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center gap-2"
                      style={{ color: "var(--color-text)" }}
                    >
                      <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>
                        {r.media_type === "tv" ? "TV" : "Film"}
                      </span>
                      {r.title ?? r.name}
                      {(r.release_date ?? r.first_air_date) && (
                        <span className="text-xs ml-auto" style={{ color: "var(--color-muted)" }}>
                          {(r.release_date ?? r.first_air_date ?? "").slice(0, 4)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
            Linking to TMDB allows cast auto-import from the credits list.
          </p>
        </div>

        {/* Core fields */}
        <Field label="Production Name *">
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. The Crown Season 7"
            style={inputStyle}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} style={{ ...inputStyle }}>
              {PRODUCTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={{ ...inputStyle }}>
              {PRODUCTION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Year">
            <input
              type="number"
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value) || new Date().getFullYear() }))}
              min={1900}
              max={2100}
              style={inputStyle}
            />
          </Field>
          <Field label="SAG-AFTRA Project Number" hint="Optional — required for compliance certificates">
            <input
              type="text"
              value={form.sagProjectNumber}
              onChange={(e) => setForm((f) => ({ ...f, sagProjectNumber: e.target.value }))}
              placeholder="e.g. 24-FS-0123"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Production Company">
          <input
            type="text"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="e.g. Left Bank Pictures"
            style={inputStyle}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Director">
            <input
              type="text"
              value={form.director}
              onChange={(e) => setForm((f) => ({ ...f, director: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="VFX Supervisor">
            <input
              type="text"
              value={form.vfxSupervisor}
              onChange={(e) => setForm((f) => ({ ...f, vfxSupervisor: e.target.value }))}
              style={inputStyle}
            />
          </Field>
        </div>

        {orgs.length > 0 && (
          <Field label="Organisation *" hint="The organisation that owns this production.">
            <select
              required
              value={form.organisationId}
              onChange={(e) => setForm((f) => ({ ...f, organisationId: e.target.value }))}
              style={{ ...inputStyle }}
            >
              <option value="">Select organisation…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {isOrgType(o.orgType) ? `${o.name} — ${ORG_TYPE_LABELS[o.orgType]}` : o.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>

        {error && (
          <p className="text-sm rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded px-5 py-2 text-sm font-medium text-white"
            style={{ background: submitting ? "var(--color-muted)" : "var(--color-accent)", cursor: submitting ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Creating…" : "Create Production"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded px-4 py-2 text-sm"
            style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
