"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ORG_TYPE_LABELS, VENDOR_ORG_TYPES, isOrgType } from "@/lib/organisations/orgTypes";

interface VendorRow {
  id: string;
  vendorOrgId: string | null;
  vendorType: string;
  status: string;
  orgName: string | null;
  orgShortCode: string | null;
  vendorAuditPassed: boolean | null;
  invitedEmail: string | null;
  invitedOrgName: string | null;
  addedAt: number;
}

interface OrgMatch {
  id: string;
  name: string;
  orgType: string;
  shortCode: string | null;
  vendorAuditPassed: boolean;
}

function typeLabel(t: string): string {
  return isOrgType(t) ? ORG_TYPE_LABELS[t] : "Vendor";
}

/**
 * Vendors attached to a production (VFX, dubbing, scan service, …). Attaching a
 * vendor lists them on the production and makes them eligible for per-licence
 * Render Bridge access — it does not grant scan data on its own, and access still
 * requires the vendor's environment audit to pass.
 *
 * Reused on the production page and as a step in the guided setup wizard.
 */
export default function VendorsPanel({ productionId, embedded = false }: { productionId: string; embedded?: boolean }) {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // Attach-existing search
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<OrgMatch[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Invite-new form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: "", orgName: "", vendorType: "vfx_vendor" });

  // Add panel toggle. Embedded (guided setup) keeps the form open inline; on the
  // production page it sits behind an "Add Vendor" button, mirroring the cast section.
  const [showAdd, setShowAdd] = useState(false);
  const addOpen = embedded || showAdd;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/vendors`);
      if (r.status === 403) { setForbidden(true); return; }
      if (!r.ok) return;
      const data = (await r.json()) as { vendors: VendorRow[] };
      setVendors(data.vendors ?? []);
    } finally {
      setLoading(false);
    }
  }, [productionId]);

  useEffect(() => { void fetchVendors(); }, [fetchVendors]);

  function handleSearch(q: string) {
    setQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length < 2) { setMatches([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/organisations/search?vendor=1&q=${encodeURIComponent(q)}`);
        const d = await r.json() as { organisations?: OrgMatch[] };
        const attachedIds = new Set(vendors.map((v) => v.vendorOrgId));
        setMatches((d.organisations ?? []).filter((o) => !attachedIds.has(o.id)));
      } catch {
        setMatches([]);
      }
    }, 250);
  }

  async function attachExisting(org: OrgMatch) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/vendors`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorOrgId: org.id }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? "Couldn't attach vendor."); return; }
      setNotice(`Attached ${org.name}.`);
      setQuery(""); setMatches([]);
      await fetchVendors();
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    const email = invite.email.trim().toLowerCase();
    const orgName = invite.orgName.trim();
    if (!email.includes("@")) { setError("Enter a valid email."); return; }
    if (!orgName) { setError("Enter the vendor's company name."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/productions/${productionId}/vendors`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, orgName, vendorType: invite.vendorType }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setError(d.error ?? "Couldn't send invite."); return; }
      setNotice(`Invite sent to ${email}.`);
      setInvite({ email: "", orgName: "", vendorType: "vfx_vendor" });
      setInviteOpen(false);
      await fetchVendors();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: VendorRow) {
    const label = row.orgName ?? row.invitedOrgName ?? row.invitedEmail ?? "this vendor";
    if (!confirm(`Remove ${label} from this production?`)) return;
    setRemovingId(row.id);
    try {
      const r = await fetch(`/api/productions/${productionId}/vendors/${row.id}`, { method: "DELETE" });
      if (r.ok) await fetchVendors();
    } finally {
      setRemovingId(null);
    }
  }

  if (forbidden) return null;

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)",
    borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none", width: "100%",
  };

  return (
    <div className={embedded ? "" : "mt-8"}>
      {!embedded && (
        <>
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
              Vendors{vendors.length > 0 ? ` · ${vendors.length}` : ""}
            </p>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: "var(--color-accent)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Vendor
            </button>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
            VFX, dubbing and scan vendors working on this production. Attaching a vendor doesn&apos;t grant scan access — that&apos;s granted per licence and requires their environment audit to pass.
          </p>
        </>
      )}

      {addOpen && (
        <div className={embedded ? "mb-3" : "rounded p-4 mb-4"} style={embedded ? undefined : { border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          {/* Attach existing */}
          <div className="relative mb-2">
            <input type="text" value={query} onChange={(e) => handleSearch(e.target.value)} placeholder="Search vendors already on Image Vault…" style={inputStyle} />
            {matches.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 rounded shadow-lg overflow-hidden" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                {matches.map((m) => (
                  <button key={m.id} type="button" disabled={busy} onClick={() => attachExisting(m)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center justify-between gap-2" style={{ color: "var(--color-text)" }}>
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>{typeLabel(m.orgType)}</span>
                      {m.name}
                    </span>
                    <span className="text-[10px]" style={{ color: m.vendorAuditPassed ? "#166534" : "#b45309" }}>{m.vendorAuditPassed ? "Audit passed" : "Audit pending"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Invite new */}
          {!inviteOpen ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded px-3 py-1.5 text-xs font-medium"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            >
              + Invite a new vendor by email
            </button>
          ) : (
            <div className="rounded p-3 space-y-2" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="email" value={invite.email} onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))} placeholder="vendor@example.com" style={inputStyle} />
                <input type="text" value={invite.orgName} onChange={(e) => setInvite((v) => ({ ...v, orgName: e.target.value }))} placeholder="Vendor company name" style={inputStyle} />
              </div>
              <div className="flex items-center gap-2">
                <select value={invite.vendorType} onChange={(e) => setInvite((v) => ({ ...v, vendorType: e.target.value }))} style={{ ...inputStyle, width: "auto", flex: 1 }}>
                  {VENDOR_ORG_TYPES.map((t) => <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>)}
                </select>
                <button type="button" onClick={sendInvite} disabled={busy} className="px-4 py-2 text-sm rounded font-medium text-white shrink-0" style={{ background: "var(--color-accent)", opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Sending…" : "Send invite"}
                </button>
                <button type="button" onClick={() => { setInviteOpen(false); setError(""); }} className="text-xs shrink-0" style={{ color: "var(--color-muted)" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs mb-2" style={{ color: "#991b1b" }}>{error}</p>}
      {notice && <p className="text-xs mb-2" style={{ color: "#166534" }}>{notice}</p>}

      {/* List */}
      {loading ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : vendors.length === 0 ? (
        <div className="rounded p-8 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>No vendors yet</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>Use the Add Vendor button to attach a VFX, dubbing or scan vendor.</p>
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                {["Vendor", "Type", "Bridge access", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium tracking-wider uppercase" style={{ color: "var(--color-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v, i) => {
                const pending = v.status === "pending";
                const name = v.orgName ?? v.invitedOrgName ?? v.invitedEmail ?? "—";
                return (
                  <tr key={v.id} style={{ borderBottom: i < vendors.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}>
                    <td className="px-4 py-3" style={{ color: "var(--color-text)" }}>
                      {name}{v.orgShortCode ? <span className="text-xs ml-1.5" style={{ color: "var(--color-muted)" }}>{v.orgShortCode}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: "var(--color-muted)" }}>{typeLabel(v.vendorType)}</td>
                    <td className="px-4 py-3">
                      {pending ? (
                        <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>
                      ) : v.vendorAuditPassed ? (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(22,101,52,0.12)", color: "#166534" }}>Audit passed</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(180,83,9,0.12)", color: "#b45309" }} title="Vendor must pass an environment audit before Render Bridge access">Audit pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={pending ? { background: "rgba(180,83,9,0.12)", color: "#b45309" } : { background: "rgba(22,101,52,0.12)", color: "#166534" }}>
                        {pending ? "Invited" : "Active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => remove(v)} disabled={removingId === v.id} className="text-xs" style={{ color: "var(--color-accent)" }}>
                        {removingId === v.id ? "Removing…" : pending ? "Cancel" : "Remove"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
