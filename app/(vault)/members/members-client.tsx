"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── types (mirror lib/compliance/members.ts) ──────────────────────────────────

interface MemberRow {
  id: string;
  name: string;
  addedAt: number;
  onPlatform: boolean;
  matchedTalentId: string | null;
  matchedEmail: string | null;
  unionAffiliation: string | null;
  packagesHeld: number;
  licencesHeld: number;
  activeProductionCount: number;
  primaryAgent: string | null;
}

interface UnionOption { id: string; shortName: string }

interface Roster {
  members: MemberRow[];
  total: number;
  onPlatform: number;
  coveragePct: number;
  unions?: UnionOption[];
  unionId?: string;
}

export default function MembersClient() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [unions, setUnions] = useState<UnionOption[]>([]);
  const [unionId, setUnionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (forUnion?: string | null) => {
    try {
      const qs = forUnion ? `?unionId=${encodeURIComponent(forUnion)}` : "";
      const res = await fetch(`/api/compliance/members${qs}`);
      const d = (await res.json()) as Roster & { error?: string };
      if (!res.ok || d.error) setError(d.error ?? `Failed (${res.status})`);
      else {
        setRoster(d);
        if (d.unions) setUnions(d.unions);
        if (d.unionId) setUnionId(d.unionId);
        setError(null);
      }
    } catch {
      setError("Failed to load roster.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectUnion = useCallback((id: string) => {
    setUnionId(id);
    setLoading(true);
    void load(id);
  }, [load]);

  const upload = useCallback(async () => {
    if (!paste.trim()) return;
    setUploading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/compliance/members", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv: paste, unionId }),
      });
      const d = (await res.json()) as { added?: number; skipped?: number; error?: string };
      if (!res.ok || d.error) setNotice(d.error ?? "Upload failed.");
      else {
        setNotice(`Added ${d.added ?? 0}${d.skipped ? `, skipped ${d.skipped} already on the roster` : ""}.`);
        setPaste("");
        await load(unionId);
      }
    } catch {
      setNotice("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  }, [paste, load, unionId]);

  const removeOne = useCallback(async (id: string) => {
    const qs = unionId ? `?unionId=${encodeURIComponent(unionId)}` : "";
    await fetch(`/api/compliance/members/${id}${qs}`, { method: "DELETE" });
    await load(unionId);
  }, [load, unionId]);

  const clearAll = useCallback(async () => {
    if (!confirm("Clear this union's member roster? This can't be undone.")) return;
    const qs = unionId ? `?unionId=${encodeURIComponent(unionId)}` : "";
    await fetch(`/api/compliance/members${qs}`, { method: "DELETE" });
    await load(unionId);
  }, [load, unionId]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (roster?.members ?? []).filter((m) => {
    if (missingOnly && m.onPlatform) return false;
    if (q && !m.name.toLowerCase().includes(q)) return false;
    return true;
  }), [roster, missingOnly, q]);

  const missingCount = (roster?.total ?? 0) - (roster?.onPlatform ?? 0);

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Oversight</p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-text)" }}>Member roster</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Paste your membership list to see who&apos;s already on ImageVault. Visibility only — getting members
          onboarded isn&apos;t mandated; this just shows the gap.
        </p>
        {unions.length > 1 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {unions.map((u) => (
              <button
                key={u.id}
                onClick={() => selectUnion(u.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-full"
                style={{
                  border: `1px solid ${unionId === u.id ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: unionId === u.id ? "var(--color-accent)" : "var(--color-surface)",
                  color: unionId === u.id ? "#fff" : "var(--color-muted)",
                }}
              >
                {u.shortName}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="rounded-lg p-4 mb-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
          Add members
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="Jane Doe, John Smith, Alex Rivera…  (commas or new lines)"
          className="w-full text-sm rounded px-3 py-2 resize-y"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
        />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => void upload()} disabled={uploading || !paste.trim()}
            className="text-sm rounded px-3 py-1.5 font-medium"
            style={{ background: "var(--color-accent)", color: "#fff", opacity: uploading || !paste.trim() ? 0.5 : 1 }}>
            {uploading ? "Adding…" : "Add to roster"}
          </button>
          {notice && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{notice}</span>}
        </div>
      </div>

      {/* Coverage summary */}
      {!loading && !error && roster && roster.total > 0 && (
        <div className="flex items-center gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="inline-flex w-40 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
              <span className="h-full rounded-full" style={{ width: `${roster.coveragePct}%`, background: roster.coveragePct === 100 ? "#166534" : roster.coveragePct > 50 ? "#b45309" : "#c0392b" }} />
            </span>
            <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>{roster.coveragePct}%</span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>on ImageVault ({roster.onPlatform}/{roster.total})</span>
          </div>
          {missingCount > 0 && (
            <span className="text-[11px] font-semibold px-2 py-1 rounded"
              style={{ color: "#b45309", background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.3)" }}>
              {missingCount} not yet on platform
            </span>
          )}
          <button onClick={() => void clearAll()} className="text-[11px] font-semibold uppercase tracking-widest ml-auto" style={{ color: "var(--color-muted)" }}>
            Clear roster
          </button>
        </div>
      )}

      {/* Controls */}
      {!loading && !error && roster && roster.total > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members…"
            className="text-sm rounded px-3 py-1.5 flex-1 min-w-[200px]"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--color-muted)" }}>
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
            Not on platform only
          </label>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded animate-pulse" style={{ height: 44, background: "var(--color-surface)", border: "1px solid var(--color-border)" }} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg px-6 py-10 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>Platform-wide access required</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{error}</p>
        </div>
      ) : !roster || roster.total === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No members yet — paste your membership list above to start.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No members match your filter.</p>
      ) : (
        <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
          {shown.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5"
              style={{ background: m.onPlatform ? undefined : "rgba(180,83,9,0.04)" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{m.name}</p>
                  {m.onPlatform && m.unionAffiliation && (
                    <span
                      className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}
                    >
                      {m.unionAffiliation}
                    </span>
                  )}
                </div>
                {m.onPlatform && (
                  <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>
                    {m.matchedEmail}
                    {m.primaryAgent ? ` · ${m.primaryAgent}` : ""}
                    {m.packagesHeld > 0 ? ` · ${m.packagesHeld} pkg${m.packagesHeld !== 1 ? "s" : ""}` : ""}
                    {m.licencesHeld > 0 ? ` · ${m.licencesHeld} licence${m.licencesHeld !== 1 ? "s" : ""}` : ""}
                    {m.activeProductionCount > 0 ? ` · ${m.activeProductionCount} production${m.activeProductionCount !== 1 ? "s" : ""}` : ""}
                  </p>
                )}
              </div>
              {m.onPlatform ? (
                <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                  style={{ color: "#1a7f37", border: "1px solid #1a7f3744", background: "rgba(26,127,55,0.08)" }}>
                  ✓ On ImageVault
                </span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded shrink-0"
                  style={{ color: "#b45309", border: "1px solid #b4530944", background: "rgba(180,83,9,0.08)" }}>
                  Not on platform
                </span>
              )}
              <button onClick={() => void removeOne(m.id)} className="text-[11px] shrink-0" style={{ color: "var(--color-muted)" }} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
