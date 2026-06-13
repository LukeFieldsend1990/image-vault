"use client";

import { useState, useEffect, useCallback } from "react";
import UploadModal from "../upload-modal";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";
import { formatScan } from "@/lib/codes/codes";

interface Transfer {
  id: string;
  transferType: "to_talent" | "to_licence";
  status: "pending" | "submitted" | "accepted" | "rejected" | "cancelled";
  lookLabel: string | null;
  fromOrgId: string;
  orgName: string;
  orgType: string | null;
  orgShortCode: string | null;
  toTalentId: string;
  targetLicenceId: string | null;
  packageId: string;
  packageName: string;
  packageScanNumber: number | null;
  packageStatus: "uploading" | "ready" | "error";
  packageSizeBytes: number | null;
  createdAt: number;
  submittedAt: number | null;
  decidedAt: number | null;
}

interface Org {
  id: string;
  name: string;
  orgType?: string | null;
}

const STATUS_STYLE: Record<Transfer["status"], { bg: string; color: string }> = {
  pending: { bg: "rgba(234,179,8,0.12)", color: "#92400e" },
  submitted: { bg: "rgba(94,106,114,0.14)", color: "#47535b" },
  accepted: { bg: "#16653418", color: "#166534" },
  rejected: { bg: "var(--color-border)", color: "var(--color-muted)" },
  cancelled: { bg: "var(--color-border)", color: "var(--color-muted)" },
};

function fmtDate(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function TransfersClient() {
  const [incoming, setIncoming] = useState<Transfer[]>([]);
  const [outgoing, setOutgoing] = useState<Transfer[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // New-delivery form
  const [showCreate, setShowCreate] = useState(false);
  const [fromOrgId, setFromOrgId] = useState("");
  const [transferType, setTransferType] = useState<"to_talent" | "to_licence">("to_talent");
  const [toTalentEmail, setToTalentEmail] = useState("");
  const [targetLicenceId, setTargetLicenceId] = useState("");
  const [lookLabel, setLookLabel] = useState("");
  const [creating, setCreating] = useState(false);

  // Upload modal target package
  const [uploadPackageId, setUploadPackageId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tRes, oRes] = await Promise.all([fetch("/api/transfers"), fetch("/api/organisations")]);
      const t = (await tRes.json()) as { incoming?: Transfer[]; outgoing?: Transfer[] };
      const o = (await oRes.json()) as { organisations?: Org[] };
      setIncoming(t.incoming ?? []);
      setOutgoing(t.outgoing ?? []);
      setOrgs(o.organisations ?? []);
      if (!fromOrgId && o.organisations?.length) setFromOrgId(o.organisations[0].id);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [fromOrgId]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "submit" | "accept" | "reject" | "cancel") {
    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch(`/api/transfers/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Action failed.");
      } else {
        await load();
      }
    } catch {
      setErr("Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function createTransfer(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromOrgId,
          transferType,
          lookLabel,
          toTalentEmail: transferType === "to_talent" ? toTalentEmail.trim() : undefined,
          targetLicenceId: transferType === "to_licence" ? targetLicenceId.trim() : undefined,
        }),
      });
      const d = (await res.json()) as { packageId?: string; error?: string };
      if (!res.ok || !d.packageId) {
        setErr(d.error ?? "Could not create delivery.");
        return;
      }
      setShowCreate(false);
      setToTalentEmail("");
      setTargetLicenceId("");
      setLookLabel("");
      await load();
      setUploadPackageId(d.packageId); // open upload modal for the staged package
    } catch {
      setErr("Could not create delivery.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <p className="text-sm p-8" style={{ color: "var(--color-muted)" }}>Loading transfers…</p>;
  }

  const canSend = orgs.length > 0;

  return (
    <div className="p-8 max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Scan Transfers</h1>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>Capture deliveries into talent vaults and against production licences.</p>
        </div>
        {canSend && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs font-medium px-4 py-2 rounded"
            style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}
          >
            New delivery
          </button>
        )}
      </div>

      {err && <p className="text-xs" style={{ color: "var(--color-accent)" }}>{err}</p>}

      {/* New delivery form */}
      {showCreate && (
        <form onSubmit={createTransfer} className="rounded border p-4 space-y-3" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>New scan delivery</p>
          <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
            Sending organisation
            <select value={fromOrgId} onChange={(e) => setFromOrgId(e.target.value)} className="mt-1 w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <div className="flex gap-4 text-xs" style={{ color: "var(--color-ink)" }}>
            <label className="flex items-center gap-1.5"><input type="radio" checked={transferType === "to_talent"} onChange={() => setTransferType("to_talent")} /> To a talent&apos;s vault</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={transferType === "to_licence"} onChange={() => setTransferType("to_licence")} /> Against a production licence</label>
          </div>
          {transferType === "to_talent" ? (
            <input value={toTalentEmail} onChange={(e) => setToTalentEmail(e.target.value)} type="email" required placeholder="Talent email" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          ) : (
            <input value={targetLicenceId} onChange={(e) => setTargetLicenceId(e.target.value)} required placeholder="Licence ID (awaiting package)" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          )}
          <input value={lookLabel} onChange={(e) => setLookLabel(e.target.value)} required placeholder="Look label — e.g. Base Look" className="w-full text-sm px-3 py-2 rounded border" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-ink)" }} />
          <div className="flex gap-2">
            <button type="submit" disabled={creating} className="text-xs font-medium px-4 py-2 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>
              {creating ? "Creating…" : "Create & upload"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-xs px-4 py-2 rounded border" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Incoming */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Incoming deliveries</h2>
        {incoming.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No incoming deliveries.</p>
        ) : (
          <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
            {incoming.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-5 py-3.5 gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                    <span className="truncate">{t.lookLabel ?? t.packageName}</span>
                    <CodeTag code={formatScan(t.packageScanNumber)} />
                  </p>
                  <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--color-muted)" }}>
                    From {t.orgName} <OrgTypeBadge type={t.orgType} /> <CodeTag code={t.orgShortCode} /> · {fmtDate(t.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusChip status={t.status} />
                  {t.status === "submitted" && (
                    <>
                      <button onClick={() => void act(t.id, "accept")} disabled={busyId === t.id} className="text-xs px-3 py-1 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>Accept</button>
                      <button onClick={() => void act(t.id, "reject")} disabled={busyId === t.id} className="text-xs px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Outgoing */}
      {canSend && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Outgoing deliveries</h2>
          {outgoing.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>No outgoing deliveries yet.</p>
          ) : (
            <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
              {outgoing.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-5 py-3.5 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: "var(--color-ink)" }}>
                      <span className="truncate">{t.lookLabel ?? t.packageName}</span>
                      <CodeTag code={formatScan(t.packageScanNumber)} />
                    </p>
                    <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--color-muted)" }}>
                      {t.transferType === "to_licence" ? "To production licence" : "To talent vault"} · {t.orgName} <CodeTag code={t.orgShortCode} /> · {fmtDate(t.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusChip status={t.status} />
                    {t.status === "pending" && (
                      <>
                        <button onClick={() => setUploadPackageId(t.packageId)} disabled={busyId === t.id} className="text-xs px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}>
                          {t.packageStatus === "ready" ? "Add more files" : "Upload files"}
                        </button>
                        <button onClick={() => void act(t.id, "submit")} disabled={busyId === t.id || t.packageStatus !== "ready"} title={t.packageStatus !== "ready" ? "Finish uploading first" : ""} className="text-xs px-3 py-1 rounded disabled:opacity-40" style={{ background: "var(--color-ink)", color: "var(--color-bg)" }}>Submit</button>
                        <button onClick={() => void act(t.id, "cancel")} disabled={busyId === t.id} className="text-xs px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Cancel</button>
                      </>
                    )}
                    {t.status === "submitted" && (
                      <button onClick={() => void act(t.id, "cancel")} disabled={busyId === t.id} className="text-xs px-3 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>Cancel</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {uploadPackageId && (
        <UploadModal
          addToPackageId={uploadPackageId}
          onClose={() => setUploadPackageId(null)}
          onComplete={() => { void load(); }}
        />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Transfer["status"] }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}
