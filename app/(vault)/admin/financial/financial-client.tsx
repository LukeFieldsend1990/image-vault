"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TALENT_TIERS, PRODUCTION_BANDS, DEFAULT_GRACE_DAYS, formatCents,
} from "@/lib/financial/config";

interface Obligation {
  id: string;
  type: "talent_tier" | "production_access";
  tier: string | null;
  band: string | null;
  amountCents: number | null;
  currency: string;
  status: "pending" | "paid" | "waived" | "cancelled";
  graceDeadline: number | null;
  notes: string | null;
  createdAt: number;
  paidAt: number | null;
  payerEmail: string | null;
  talentEmail: string | null;
  projectName: string | null;
}

interface TalentResult { id: string; email: string }

const STATUS_STYLE: Record<Obligation["status"], { bg: string; color: string }> = {
  pending: { bg: "rgba(234,179,8,0.12)", color: "#92400e" },
  paid: { bg: "#16653418", color: "#166534" },
  waived: { bg: "var(--color-border)", color: "var(--color-muted)" },
  cancelled: { bg: "var(--color-border)", color: "var(--color-muted)" },
};

function fmtDate(epoch: number | null) {
  return epoch ? new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function FinancialClient() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Record-fee form
  const [type, setType] = useState<"talent_tier" | "production_access">("talent_tier");
  const [talentQuery, setTalentQuery] = useState("");
  const [talentResults, setTalentResults] = useState<TalentResult[]>([]);
  const [talent, setTalent] = useState<TalentResult | null>(null);
  const [tier, setTier] = useState("emerging");
  const [licenceId, setLicenceId] = useState("");
  const [band, setBand] = useState("band_1");
  const [graceDays, setGraceDays] = useState(String(DEFAULT_GRACE_DAYS));
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fee-obligations");
      const d = (await res.json()) as { obligations?: Obligation[] };
      setObligations(d.obligations ?? []);
    } catch {
      setErr("Could not load obligations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function onTalentQuery(v: string) {
    setTalentQuery(v); setTalent(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setTalentResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users/search?role=talent&email=${encodeURIComponent(v.trim())}`);
        const d = (await res.json()) as { users?: TalentResult[] };
        setTalentResults(d.users ?? []);
      } catch { setTalentResults([]); }
    }, 300);
  }

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const payload = type === "talent_tier"
        ? { type, talentId: talent?.id, tier, graceDays: Number(graceDays) || 0 }
        : { type, licenceId: licenceId.trim(), band, graceDays: Number(graceDays) || 0 };
      const res = await fetch("/api/admin/fee-obligations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Could not record fee.");
      } else {
        setTalent(null); setTalentQuery(""); setTalentResults([]); setLicenceId("");
        await load();
      }
    } catch { setErr("Could not record fee."); }
    finally { setBusy(false); }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/fee-obligations/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = (await res.json()) as { error?: string }; setErr(d.error ?? "Update failed."); }
      else await load();
    } catch { setErr("Update failed."); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Billing &amp; Fees</h1>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Upfront fee model (under test). Talent only see fees when their per-user visibility flag is on.</p>
      </div>

      {/* Config reference */}
      <section className="grid grid-cols-2 gap-4">
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Talent tiers</h2>
          {TALENT_TIERS.map((t) => (
            <div key={t.id} className="flex justify-between text-sm py-0.5"><span style={{ color: "var(--color-ink)" }}>{t.label}</span><span style={{ color: "var(--color-muted)" }}>{formatCents(t.amountCents)}</span></div>
          ))}
        </div>
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--color-muted)" }}>Production bands</h2>
          {PRODUCTION_BANDS.map((b) => (
            <div key={b.id} className="flex justify-between text-sm py-0.5"><span style={{ color: "var(--color-ink)" }}>{b.label}</span><span style={{ color: "var(--color-muted)" }}>{formatCents(b.amountCents)}</span></div>
          ))}
        </div>
      </section>

      {/* Record fee */}
      <section className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>Record a fee</h2>
        <form onSubmit={record} className="space-y-3">
          <div className="flex gap-4 text-xs" style={{ color: "var(--color-ink)" }}>
            <label className="flex items-center gap-1.5"><input type="radio" checked={type === "talent_tier"} onChange={() => setType("talent_tier")} /> Talent tier fee</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={type === "production_access"} onChange={() => setType("production_access")} /> Production access fee</label>
          </div>

          {type === "talent_tier" ? (
            <div className="space-y-2">
              <div className="relative">
                <input value={talent ? talent.email : talentQuery} onChange={(e) => onTalentQuery(e.target.value)} placeholder="Search talent by email…" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
                {talentResults.length > 0 && !talent && (
                  <div className="absolute z-10 left-0 right-0 mt-1 rounded border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                    {talentResults.map((u) => (
                      <button type="button" key={u.id} onClick={() => { setTalent(u); setTalentResults([]); }} className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface)]" style={{ color: "var(--color-ink)" }}>{u.email}</button>
                    ))}
                  </div>
                )}
              </div>
              <select value={tier} onChange={(e) => setTier(e.target.value)} className="text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
                {TALENT_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label} — {formatCents(t.amountCents)}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <input value={licenceId} onChange={(e) => setLicenceId(e.target.value)} placeholder="Licence ID" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
              <select value={band} onChange={(e) => setBand(e.target.value)} className="text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
                {PRODUCTION_BANDS.map((b) => <option key={b.id} value={b.id}>{b.label} — {formatCents(b.amountCents)}</option>)}
              </select>
            </div>
          )}

          <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
            Grace (days)
            <input type="number" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className="ml-2 w-20 text-sm px-2 py-1 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          </label>

          <button type="submit" disabled={busy || (type === "talent_tier" && !talent)} className="text-xs font-medium px-4 py-2 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>
            {busy ? "Saving…" : "Record fee"}
          </button>
        </form>
        {err && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>}
      </section>

      {/* Obligations */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Fee obligations</h2>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
        ) : obligations.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No fees recorded yet.</p>
        ) : (
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {obligations.map((o) => {
              const s = STATUS_STYLE[o.status];
              const subject = o.type === "talent_tier"
                ? `${o.talentEmail ?? "talent"} · ${o.tier ?? ""}`
                : `${o.projectName ?? "production"} · ${o.band ?? ""}`;
              return (
                <div key={o.id} className="flex items-center justify-between px-4 py-3 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: "var(--color-ink)" }}>{subject}</p>
                    <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                      {o.type === "talent_tier" ? "Talent tier" : "Production access"} · {formatCents(o.amountCents, o.currency)} · grace {fmtDate(o.graceDeadline)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>{o.status}</span>
                    {o.status === "pending" && (
                      <>
                        <button onClick={() => void setStatus(o.id, "paid")} disabled={busy} className="text-xs px-2.5 py-1 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>Mark paid</button>
                        <button onClick={() => void setStatus(o.id, "waived")} disabled={busy} className="text-xs px-2.5 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Waive</button>
                        <button onClick={() => void setStatus(o.id, "cancelled")} disabled={busy} className="text-xs px-2.5 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
