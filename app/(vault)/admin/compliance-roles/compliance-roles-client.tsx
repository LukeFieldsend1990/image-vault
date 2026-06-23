"use client";

import { useState, useCallback, useRef } from "react";
import type {
  ComplianceRolesOverview,
  UnionSummary,
  InsurerSummary,
  WatcherGrant,
} from "@/lib/compliance/compliance-roles";
import { UNION_PRESETS } from "@/lib/compliance/unions";

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(total: number, currencies: string[]) {
  if (total <= 0) return "—";
  const ccy = currencies.length === 1 ? currencies[0] : "USD";
  try {
    const s = new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(total);
    return currencies.length > 1 ? `${s} (mixed)` : s;
  } catch {
    return `${total.toLocaleString()} ${ccy}`;
  }
}

const SUBTYPE_LABEL: Record<string, string> = { union: "Union", regulator: "Regulator", insurer: "Insurer" };

type Tab = "unions" | "insurers" | "watchers" | "grant";

export default function ComplianceRolesClient({ initial }: { initial: ComplianceRolesOverview }) {
  const [data, setData] = useState<ComplianceRolesOverview>(initial);
  const [tab, setTab] = useState<Tab>("unions");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/compliance-roles");
      if (!res.ok) throw new Error();
      setData((await res.json()) as ComplianceRolesOverview);
    } catch {
      setErr("Could not refresh.");
    }
  }, []);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/admin/compliance-grants/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setErr(d.error ?? "Revoke failed.");
        } else {
          await refresh();
        }
      } catch {
        setErr("Revoke failed.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const { unions, insurers, watchers, counts } = data;

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Compliance Roles
        </h1>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Manage the oversight bodies that watch the platform: union presets and their regimes, insurer cover, active
          watcher grants, and grant new compliance account access.
        </p>
      </div>

      {err && (
        <p className="text-xs" style={{ color: "var(--color-accent)" }}>
          {err}
        </p>
      )}

      <div className="flex gap-2 flex-wrap text-[11px]" style={{ color: "var(--color-muted)" }}>
        <Chip label={`${counts.union} union`} />
        <Chip label={`${counts.insurer} insurer`} />
        <Chip label={`${counts.regulator} regulator`} />
        <Chip label={`${counts.total} total grants`} />
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        <TabButton active={tab === "unions"} onClick={() => setTab("unions")}>
          Unions
        </TabButton>
        <TabButton active={tab === "insurers"} onClick={() => setTab("insurers")}>
          Insurers
        </TabButton>
        <TabButton active={tab === "watchers"} onClick={() => setTab("watchers")}>
          Watchers
        </TabButton>
        <TabButton active={tab === "grant"} onClick={() => setTab("grant")}>
          Grant Access
        </TabButton>
      </div>

      {tab === "unions" && <UnionsTab unions={unions} />}
      {tab === "insurers" && <InsurersTab insurers={insurers} />}
      {tab === "watchers" && <WatchersTab watchers={watchers} busy={busy} onRevoke={revoke} />}
      {tab === "grant" && <GrantTab onGranted={refresh} />}
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {label}
    </span>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium px-3 py-2 -mb-px border-b-2"
      style={{
        borderColor: active ? "var(--color-accent)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-muted)",
      }}
    >
      {children}
    </button>
  );
}

function UnionsTab({ unions }: { unions: UnionSummary[] }) {
  return (
    <section className="space-y-3">
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        Two first-party presets. A production falls under a union when it is flagged for it; the union&apos;s regime
        defines the obligations evaluated against those productions. Watcher accounts are listed under the Watchers tab.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {unions.map((u) => (
          <div
            key={u.id}
            className="rounded border p-4 space-y-3"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {u.shortName}
              </h3>
              <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                {u.name}
              </p>
            </div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {u.description}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Jurisdiction" value={u.jurisdiction} />
              <Stat label="Regime" value={u.regimeName ?? u.regimeId} />
              <Stat label="Obligations" value={`${u.obligationCount} (${u.requiredCount} required)`} />
              <Stat label="Productions" value={`${u.productionCount} (${u.activeProductionCount} active)`} />
              <Stat label="Watchers" value={`${u.watcherCount}`} />
              <Stat
                label="Roster"
                value={u.rosterTotal === 0 ? "—" : `${u.rosterCoveragePct}% (${u.rosterOnPlatform}/${u.rosterTotal})`}
              />
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
        {label}
      </dt>
      <dd style={{ color: "var(--color-ink)" }}>{value}</dd>
    </div>
  );
}

function InsurersTab({ insurers }: { insurers: InsurerSummary[] }) {
  return (
    <section className="space-y-3">
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        Insurer access is bound per production — never platform- or org-wide. Each grant below covers a single
        production; policies are recorded by the insurer against that grant.
      </p>
      {insurers.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No insurer grants yet.
        </p>
      ) : (
        <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
          {insurers.map((i) => (
            <div key={i.grantId} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {i.email ?? i.complianceUserId}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {i.productionName ?? i.productionId ?? "—"} · {i.policyCount} {i.policyCount === 1 ? "policy" : "policies"} ·{" "}
                  {fmtMoney(i.coverageTotal, i.currencies)} · {fmtDate(i.createdAt)}
                </p>
              </div>
              {i.hasLapsedPolicy && (
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
                >
                  Lapsed policy
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface UserResult {
  id: string;
  email: string;
}

const UNION_LABEL: Record<string, string> = Object.fromEntries(UNION_PRESETS.map((u) => [u.id, u.shortName]));

function GrantTab({ onGranted }: { onGranted: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [watcher, setWatcher] = useState<UserResult | null>(null);
  const [subtype, setSubtype] = useState("union");
  const [unionId, setUnionId] = useState<string>(UNION_PRESETS[0]?.id ?? "");
  const [scope, setScope] = useState("production");
  const [scopeId, setScopeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQuery(v: string) {
    setQuery(v);
    setWatcher(null);
    setSuccess(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users/search?role=compliance&email=${encodeURIComponent(v.trim())}`);
        const d = (await res.json()) as { users?: UserResult[] };
        setResults(d.users ?? []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setSuccess(false);
    try {
      const res = await fetch("/api/admin/compliance-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          complianceUserId: watcher?.id,
          subtype,
          unionId: subtype === "union" ? unionId : undefined,
          scope,
          scopeId: scope === "platform" || scope === "union" ? undefined : scopeId.trim(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Could not grant.");
      } else {
        setWatcher(null); setQuery(""); setResults([]); setScopeId(""); setSuccess(true);
        await onGranted();
      }
    } catch { setErr("Could not grant."); }
    finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 max-w-lg">
      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
        Grant read-only evidence access to a Union, Regulator, or Insurer compliance account. Invite the account first
        (role: Compliance), then grant scopes here.
      </p>

      {err && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>}
      {success && <p className="text-xs" style={{ color: "var(--color-ink)" }}>Access granted.</p>}

      <form onSubmit={grant} className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Grant access</h2>
        <div className="relative">
          <input
            value={watcher ? watcher.email : query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search compliance account by email…"
            className="w-full text-sm px-3 py-2 rounded border"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
          />
          {results.length > 0 && !watcher && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
              {results.map((u) => (
                <button type="button" key={u.id} onClick={() => { setWatcher(u); setResults([]); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink)" }}>
                  {u.email}
                </button>
              ))}
            </div>
          )}
          {!watcher && query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--color-muted)" }}>No compliance accounts match. Check the account has accepted its invite and completed signup.</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={subtype}
            onChange={(e) => { const v = e.target.value; setSubtype(v); if (v !== "union" && scope === "union") setScope("production"); }}
            className="text-sm px-2 py-2 rounded border"
            style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
          >
            <option value="union">Union</option>
            <option value="regulator">Regulator</option>
            <option value="insurer">Insurer</option>
          </select>
          {subtype === "union" && (
            <select value={unionId} onChange={(e) => setUnionId(e.target.value)} className="text-sm px-2 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
              {UNION_PRESETS.map((u) => <option key={u.id} value={u.id}>{UNION_LABEL[u.id] ?? u.id}</option>)}
            </select>
          )}
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="text-sm px-2 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
            {subtype === "union" && <option value="union">Union (affiliated)</option>}
            <option value="production">Production</option>
            <option value="organisation">Organisation</option>
            <option value="talent">Talent</option>
            <option value="platform">Platform-wide</option>
          </select>
          {scope !== "platform" && scope !== "union" && (
            <input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder={`${scope} ID`}
              className="flex-1 min-w-[160px] text-sm px-3 py-2 rounded border"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
            />
          )}
        </div>
        <button type="submit" disabled={busy || !watcher} className="text-xs font-medium px-4 py-2 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>
          {busy ? "Saving…" : "Grant"}
        </button>
      </form>
    </section>
  );
}

function WatchersTab({
  watchers,
  busy,
  onRevoke,
}: {
  watchers: WatcherGrant[];
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const shown = filter === "all" ? watchers : watchers.filter((w) => w.subtype === filter);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {["all", "union", "insurer", "regulator"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="text-[11px] px-2.5 py-1 rounded-full border"
            style={{
              borderColor: filter === f ? "var(--color-accent)" : "var(--color-border)",
              color: filter === f ? "var(--color-ink)" : "var(--color-muted)",
              background: "var(--color-surface)",
            }}
          >
            {f === "all" ? "All" : SUBTYPE_LABEL[f]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No active grants.
        </p>
      ) : (
        <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
          {shown.map((w) => (
            <div key={w.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {w.email ?? w.complianceUserId}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {SUBTYPE_LABEL[w.subtype] ?? w.subtype}
                  {w.unionShortName ? ` · ${w.unionShortName}` : ""} · {w.scope}
                  {w.scopeLabel ? ` · ${w.scopeLabel}` : w.scopeId ? ` · ${w.scopeId}` : ""} · {fmtDate(w.createdAt)}
                </p>
              </div>
              <button
                onClick={() => onRevoke(w.id)}
                disabled={busy}
                className="text-xs px-2.5 py-1 rounded border disabled:opacity-40 shrink-0"
                style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
