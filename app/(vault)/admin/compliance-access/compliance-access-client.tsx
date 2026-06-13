"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Grant {
  id: string;
  complianceUserId: string;
  email: string | null;
  subtype: string;
  scope: string;
  scopeId: string | null;
  createdAt: number;
}

interface UserResult { id: string; email: string }

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function ComplianceAccessClient() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [watcher, setWatcher] = useState<UserResult | null>(null);
  const [subtype, setSubtype] = useState("union");
  const [scope, setScope] = useState("production");
  const [scopeId, setScopeId] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/compliance-grants");
      const d = (await res.json()) as { grants?: Grant[] };
      setGrants(d.grants ?? []);
    } catch { setErr("Could not load grants."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function onQuery(v: string) {
    setQuery(v); setWatcher(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users/search?role=compliance&email=${encodeURIComponent(v.trim())}`);
        const d = (await res.json()) as { users?: UserResult[] };
        setResults(d.users ?? []);
      } catch { setResults([]); }
    }, 300);
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/compliance-grants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complianceUserId: watcher?.id, subtype, scope, scopeId: scope === "platform" ? undefined : scopeId.trim() }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; setErr(d.error ?? "Could not grant."); }
      else { setWatcher(null); setQuery(""); setResults([]); setScopeId(""); await load(); }
    } catch { setErr("Could not grant."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/compliance-grants/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; setErr(d.error ?? "Revoke failed."); }
      else await load();
    } catch { setErr("Revoke failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Compliance Access</h1>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Grant read-only Union / Regulator / Insurer accounts evidence access to a scope. Invite the account first (role: Compliance), then grant scopes here.</p>
      </div>

      {err && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>}

      <form onSubmit={grant} className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Grant access</h2>
        <div className="relative">
          <input value={watcher ? watcher.email : query} onChange={(e) => onQuery(e.target.value)} placeholder="Search compliance account by email…" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          {results.length > 0 && !watcher && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
              {results.map((u) => <button type="button" key={u.id} onClick={() => { setWatcher(u); setResults([]); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink)" }}>{u.email}</button>)}
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className="text-sm px-2 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
            <option value="union">Union</option><option value="regulator">Regulator</option><option value="insurer">Insurer</option>
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="text-sm px-2 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
            <option value="production">Production</option><option value="organisation">Organisation</option><option value="talent">Talent</option><option value="platform">Platform-wide</option>
          </select>
          {scope !== "platform" && (
            <input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder={`${scope} ID`} className="flex-1 min-w-[160px] text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          )}
        </div>
        <button type="submit" disabled={busy || !watcher} className="text-xs font-medium px-4 py-2 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>{busy ? "Saving…" : "Grant"}</button>
      </form>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Active grants</h2>
        {loading ? <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
          : grants.length === 0 ? <p className="text-sm" style={{ color: "var(--color-muted)" }}>No grants yet.</p>
          : (
            <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
              {grants.map((g) => (
                <div key={g.id} className="flex items-center justify-between px-4 py-3 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{g.email ?? g.complianceUserId}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>{g.subtype} · {g.scope}{g.scopeId ? ` · ${g.scopeId}` : ""} · {fmtDate(g.createdAt)}</p>
                  </div>
                  <button onClick={() => void revoke(g.id)} disabled={busy} className="text-xs px-2.5 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Revoke</button>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
