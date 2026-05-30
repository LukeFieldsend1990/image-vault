"use client";

import { useCallback, useEffect, useState } from "react";

interface Strike {
  id: string;
  scope: string;
  scopeId: string | null;
  reason: string;
  status: "active" | "lifted";
  declaredAt: number;
}
interface Transfer {
  id: string;
  licenceId: string;
  toPartyName: string;
  status: string;
}
interface LedgerEvent {
  id: string;
  eventType: string;
  clauseRef: string | null;
  licenceId: string | null;
  createdAt: number;
}
interface Certificate {
  id: string;
  scope: string;
  scopeId: string;
  regime: string;
  ledgerTipHash: string;
  generatedAt: number;
}
interface Overview {
  strikes: Strike[];
  pendingTransfers: Transfer[];
  recentEvents: LedgerEvent[];
  certificates: Certificate[];
}

const headerCls = "text-[10px] uppercase tracking-widest font-semibold mb-2";
const cardStyle = { border: "1px solid var(--color-border)", background: "var(--color-surface)" };

export default function AdminComplianceClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/compliance/overview");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Strikes ──
  const [strikeScope, setStrikeScope] = useState("global");
  const [strikeScopeId, setStrikeScopeId] = useState("");
  const [strikeReason, setStrikeReason] = useState("");

  async function declareStrike() {
    setBusy("declare");
    try {
      await fetch("/api/compliance/strikes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: strikeScope, scopeId: strikeScopeId || undefined, reason: strikeReason }),
      });
      setStrikeReason("");
      setStrikeScopeId("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function liftStrike(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/compliance/strikes/${id}`, { method: "PATCH" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  // ── Transfers ──
  async function decideTransfer(id: string, decision: "approved" | "denied", unionApproved: boolean) {
    setBusy(id);
    try {
      await fetch(`/api/compliance/transfers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, unionApproved }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  // ── Certificate ──
  const [certScope, setCertScope] = useState("licence");
  const [certScopeId, setCertScopeId] = useState("");
  const [certUrl, setCertUrl] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);

  async function generateCert() {
    setBusy("cert");
    setCertUrl(null);
    setCertError(null);
    try {
      const res = await fetch("/api/compliance/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: certScope, scopeId: certScopeId.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && json.url) {
        setCertUrl(json.url);
        await load();
      } else {
        setCertError(json.error || `Generation failed (HTTP ${res.status}).`);
      }
    } catch {
      setCertError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function verifyCert(id: string) {
    setVerifyState((p) => ({ ...p, [id]: "…" }));
    const res = await fetch(`/api/compliance/verify?certificateId=${id}`);
    const json = (await res.json()) as { ok: boolean };
    setVerifyState((p) => ({ ...p, [id]: json.ok ? "✓ intact" : "✗ tampered" }));
  }

  const input = "text-sm rounded px-2 py-1";
  const inputStyle = { border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };
  const btn = "text-xs px-3 py-1 rounded disabled:opacity-50";
  const primary = { background: "var(--color-accent)", color: "#fff" };

  return (
    <div className="space-y-6">
      {/* Certificate generator — the demo moment */}
      <section className="rounded p-4" style={cardStyle}>
        <p className={headerCls} style={{ color: "var(--color-accent)" }}>
          Generate SAG-AFTRA Compliance Certificate
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} style={inputStyle} value={certScope} onChange={(e) => setCertScope(e.target.value)}>
            <option value="licence">licence</option>
            <option value="talent">talent</option>
            <option value="production">production</option>
          </select>
          <input className={input} style={inputStyle} placeholder={`${certScope} id`} value={certScopeId} onChange={(e) => setCertScopeId(e.target.value)} />
          <button className={btn} style={primary} disabled={busy === "cert" || !certScopeId} onClick={generateCert}>
            {busy === "cert" ? "Generating…" : "Generate certificate"}
          </button>
          {certUrl && (
            <a href={certUrl} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--color-accent)" }}>
              ✓ Certificate generated — open ↗
            </a>
          )}
          {certError && (
            <span className="text-xs" style={{ color: "var(--color-accent)" }}>
              ⚠ {certError}
            </span>
          )}
        </div>
      </section>

      {/* Strike board */}
      <section className="rounded p-4" style={cardStyle}>
        <p className={headerCls} style={{ color: "var(--color-muted)" }}>
          Strike board (39.G)
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select className={input} style={inputStyle} value={strikeScope} onChange={(e) => setStrikeScope(e.target.value)}>
            <option value="global">global</option>
            <option value="organisation">organisation</option>
            <option value="production">production</option>
            <option value="licence">licence</option>
          </select>
          {strikeScope !== "global" && (
            <input className={input} style={inputStyle} placeholder="scope id" value={strikeScopeId} onChange={(e) => setStrikeScopeId(e.target.value)} />
          )}
          <input className={input} style={inputStyle} placeholder="reason" value={strikeReason} onChange={(e) => setStrikeReason(e.target.value)} />
          <button className={btn} style={primary} disabled={busy === "declare" || !strikeReason} onClick={declareStrike}>
            Declare strike
          </button>
        </div>
        <ul className="space-y-1">
          {(data?.strikes ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between text-sm" style={{ color: "var(--color-text)" }}>
              <span>
                <strong>{s.scope}</strong>
                {s.scopeId ? `:${s.scopeId}` : ""} — {s.reason}{" "}
                <span style={{ color: s.status === "active" ? "var(--color-accent)" : "var(--color-muted)" }}>[{s.status}]</span>
              </span>
              {s.status === "active" && (
                <button className="text-xs underline" style={{ color: "var(--color-accent)" }} disabled={busy === s.id} onClick={() => liftStrike(s.id)}>
                  Lift
                </button>
              )}
            </li>
          ))}
          {(data?.strikes ?? []).length === 0 && <li className="text-xs" style={{ color: "var(--color-muted)" }}>No strikes.</li>}
        </ul>
      </section>

      {/* Transfer queue */}
      <section className="rounded p-4" style={cardStyle}>
        <p className={headerCls} style={{ color: "var(--color-muted)" }}>
          Transfer queue (39.I)
        </p>
        <ul className="space-y-1">
          {(data?.pendingTransfers ?? []).map((tr) => (
            <li key={tr.id} className="flex items-center justify-between text-sm" style={{ color: "var(--color-text)" }}>
              <span>
                {tr.licenceId} → {tr.toPartyName}
              </span>
              <span className="flex gap-2">
                <button className="text-xs underline" style={{ color: "var(--color-accent)" }} disabled={busy === tr.id} onClick={() => decideTransfer(tr.id, "approved", true)}>
                  Approve (Union)
                </button>
                <button className="text-xs underline" style={{ color: "var(--color-muted)" }} disabled={busy === tr.id} onClick={() => decideTransfer(tr.id, "denied", false)}>
                  Deny
                </button>
              </span>
            </li>
          ))}
          {(data?.pendingTransfers ?? []).length === 0 && <li className="text-xs" style={{ color: "var(--color-muted)" }}>No pending transfers.</li>}
        </ul>
      </section>

      {/* Certificate history */}
      <section className="rounded p-4" style={cardStyle}>
        <p className={headerCls} style={{ color: "var(--color-muted)" }}>
          Certificate history
        </p>
        <ul className="space-y-1">
          {(data?.certificates ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between text-sm" style={{ color: "var(--color-text)" }}>
              <a href={`/api/compliance/certificates/${c.id}`} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--color-accent)" }}>
                {c.scope}:{c.scopeId} · {c.regime}
              </a>
              <span className="flex items-center gap-3">
                <code className="text-[11px]" style={{ color: "var(--color-muted)" }}>{c.ledgerTipHash.slice(0, 12)}…</code>
                <button className="text-xs underline" style={{ color: "var(--color-muted)" }} onClick={() => verifyCert(c.id)}>
                  {verifyState[c.id] ?? "verify"}
                </button>
              </span>
            </li>
          ))}
          {(data?.certificates ?? []).length === 0 && <li className="text-xs" style={{ color: "var(--color-muted)" }}>No certificates yet.</li>}
        </ul>
      </section>

      {/* Ledger viewer */}
      <section className="rounded p-4" style={cardStyle}>
        <p className={headerCls} style={{ color: "var(--color-muted)" }}>
          Recent ledger events
        </p>
        <ul className="space-y-1">
          {(data?.recentEvents ?? []).map((e) => (
            <li key={e.id} className="text-sm flex justify-between" style={{ color: "var(--color-text)" }}>
              <span>
                {e.eventType} {e.clauseRef ? `(${e.clauseRef})` : ""}
              </span>
              <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>{e.licenceId ?? "—"}</span>
            </li>
          ))}
          {(data?.recentEvents ?? []).length === 0 && <li className="text-xs" style={{ color: "var(--color-muted)" }}>No events.</li>}
        </ul>
      </section>
    </div>
  );
}
