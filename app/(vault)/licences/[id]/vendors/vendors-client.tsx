"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import OrgTypeBadge from "@/app/components/org-type-badge";

interface Authorisation {
  id: string;
  vendorOrgId: string;
  orgName: string;
  orgType: string | null;
  vendorAuditPassed: boolean;
  parentAuthorisationId: string | null;
  nominatedByOrgId: string | null;
  status: "active" | "revoked";
  createdAt: number;
  revokedAt: number | null;
}

interface LicenceSummary {
  id: string;
  projectName: string;
  status: string;
  licenceType: string | null;
  validFrom: number;
  validTo: number;
}

interface OrgResult {
  id: string;
  name: string;
  orgType: string | null;
  vendorAuditPassed: boolean;
}

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function VendorsClient({ licenceId }: { licenceId: string }) {
  const [licence, setLicence] = useState<LicenceSummary | null>(null);
  const [auths, setAuths] = useState<Authorisation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [memberOrgIds, setMemberOrgIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Authorise-vendor picker (nominateParent = null → direct; else sub-vendor under that auth)
  const [pickerFor, setPickerFor] = useState<string | "direct" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrgResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/licences/${licenceId}/vendors`);
      if (res.status === 403) { setForbidden(true); return; }
      const d = (await res.json()) as { canManage?: boolean; memberOrgIds?: string[]; authorisations?: Authorisation[]; licence?: LicenceSummary };
      setCanManage(!!d.canManage);
      setMemberOrgIds(d.memberOrgIds ?? []);
      setAuths(d.authorisations ?? []);
      setLicence(d.licence ?? null);
    } catch {
      setErr("Could not load vendor access.");
    } finally {
      setLoading(false);
    }
  }, [licenceId]);

  useEffect(() => { void load(); }, [load]);

  function onQuery(v: string) {
    setQuery(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organisations/search?vendor=1&q=${encodeURIComponent(v.trim())}`);
        const d = (await res.json()) as { organisations?: OrgResult[] };
        setResults(d.organisations ?? []);
      } catch { setResults([]); }
    }, 300);
  }

  async function authorise(vendorOrgId: string, parentAuthorisationId?: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/licences/${licenceId}/vendors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorOrgId, parentAuthorisationId }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Could not authorise vendor.");
      } else {
        setPickerFor(null); setQuery(""); setResults([]);
        await load();
      }
    } catch { setErr("Could not authorise vendor."); }
    finally { setBusy(false); }
  }

  async function revoke(authId: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/licences/${licenceId}/vendors/${authId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Could not revoke.");
      } else { await load(); }
    } catch { setErr("Could not revoke."); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm p-8" style={{ color: "var(--color-muted)" }}>Loading vendor access…</p>;
  if (forbidden) return <p className="text-sm p-8" style={{ color: "var(--color-muted)" }}>You don&apos;t have access to this licence&apos;s vendors.</p>;

  const directAuths = auths.filter((a) => !a.parentAuthorisationId);
  const subsByParent = (parentId: string) => auths.filter((a) => a.parentAuthorisationId === parentId);

  function VendorRow({ a, depth }: { a: Authorisation; depth: number }) {
    const canNominate = a.status === "active" && memberOrgIds.includes(a.vendorOrgId);
    const canRevoke = a.status === "active" && (canManage || (a.nominatedByOrgId && memberOrgIds.includes(a.nominatedByOrgId)));
    const subs = subsByParent(a.id);
    return (
      <>
        <div className="flex items-center justify-between px-5 py-3 gap-4" style={{ paddingLeft: 20 + depth * 24 }}>
          <div className="min-w-0 flex items-center gap-2">
            {depth > 0 && <span style={{ color: "var(--color-muted)" }}>↳</span>}
            <span className="text-sm truncate" style={{ color: a.status === "active" ? "var(--color-ink)" : "var(--color-muted)" }}>{a.orgName}</span>
            <OrgTypeBadge type={a.orgType} />
            {a.vendorAuditPassed
              ? <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "#16653418", color: "#166534" }}>Audit ✓</span>
              : <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }} title="Vendor cannot pull until the environment audit passes">No audit</span>}
            {a.status === "revoked" && <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>revoked</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canNominate && (
              <button onClick={() => setPickerFor(a.id)} disabled={busy} className="text-xs px-2.5 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}>+ Sub-vendor</button>
            )}
            {canRevoke && (
              <button onClick={() => void revoke(a.id)} disabled={busy} className="text-xs px-2.5 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Revoke</button>
            )}
          </div>
        </div>
        {pickerFor === a.id && <Picker onPick={(orgId) => void authorise(orgId, a.id)} />}
        {subs.map((s) => <VendorRow key={s.id} a={s} depth={depth + 1} />)}
      </>
    );
  }

  function Picker({ onPick }: { onPick: (orgId: string) => void }) {
    return (
      <div className="px-5 py-3 border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search vendor organisations…"
          className="w-full text-sm px-3 py-2 rounded border"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}
        />
        {results.length > 0 && (
          <div className="mt-2 rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {results.map((o) => (
              <button key={o.id} onClick={() => onPick(o.id)} disabled={busy} className="w-full flex items-center justify-between px-3 py-2 text-left border-b last:border-0 hover:bg-[var(--color-bg)] disabled:opacity-40" style={{ borderColor: "var(--color-border)" }}>
                <span className="text-sm flex items-center gap-2" style={{ color: "var(--color-ink)" }}>{o.name} <OrgTypeBadge type={o.orgType} /></span>
                {!o.vendorAuditPassed && <span className="text-[10px]" style={{ color: "#b45309" }}>no audit</span>}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => { setPickerFor(null); setQuery(""); setResults([]); }} className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <Link href="/licences" className="text-xs" style={{ color: "var(--color-muted)" }}>← Licences</Link>
        <h1 className="text-lg font-semibold tracking-tight mt-2" style={{ color: "var(--color-ink)" }}>Vendor access</h1>
        {licence && (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {licence.projectName} · {licence.licenceType ?? "—"} · {fmtDate(licence.validFrom)} → {fmtDate(licence.validTo)} · {licence.status}
          </p>
        )}
      </div>

      {err && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>}

      {canManage && (
        <div>
          {pickerFor === "direct" ? (
            <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
              <Picker onPick={(orgId) => void authorise(orgId)} />
            </div>
          ) : (
            <button onClick={() => setPickerFor("direct")} className="text-xs font-medium px-4 py-2 rounded" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>Authorise a vendor</button>
          )}
        </div>
      )}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Authorised vendors</h2>
        {directAuths.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No vendors authorised yet.</p>
        ) : (
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {directAuths.map((a) => <VendorRow key={a.id} a={a} depth={0} />)}
          </div>
        )}
        <p className="text-[11px] mt-3" style={{ color: "var(--color-muted)" }}>
          Vendors can only pull via the Render Bridge once their environment audit has passed. Access is bounded by this licence&apos;s type and validity window.
        </p>
      </section>
    </div>
  );
}
