"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type {
  ComplianceRolesOverview,
  UnionSummary,
  InsurerSummary,
  WatcherGrant,
} from "@/lib/compliance/compliance-roles";

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

type Tab = "unions" | "insurers" | "watchers";

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
          Manage the oversight bodies that watch the platform: union presets and their regimes, insurer cover, and every
          active watcher grant. To grant a new account access, use{" "}
          <Link href="/admin/compliance-access" className="underline" style={{ color: "var(--color-accent)" }}>
            Compliance Access
          </Link>
          .
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
      </div>

      {tab === "unions" && <UnionsTab unions={unions} />}
      {tab === "insurers" && <InsurersTab insurers={insurers} />}
      {tab === "watchers" && <WatchersTab watchers={watchers} busy={busy} onRevoke={revoke} />}
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
