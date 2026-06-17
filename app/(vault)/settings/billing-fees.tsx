"use client";

import { useState, useEffect } from "react";
import { tierDef, formatCents } from "@/lib/financial/config";

interface Obligation {
  id: string;
  type: "talent_tier" | "production_access";
  tier: string | null;
  band: string | null;
  amountCents: number | null;
  currency: string;
  status: "pending" | "paid" | "waived" | "cancelled";
  graceDeadline: number | null;
  createdAt: number;
}

function fmtDate(epoch: number | null) {
  return epoch ? new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS_LABEL: Record<Obligation["status"], string> = {
  pending: "Pending", paid: "Paid", waived: "Waived", cancelled: "Cancelled",
};

/**
 * Talent-facing fee summary. Renders nothing unless the server reports the
 * financial model is visible for this user (per-user flag, default off), so the
 * whole feature stays hidden from talent while it's under test.
 */
export default function BillingFees() {
  const [visible, setVisible] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/me/fees");
        const d = (await res.json()) as { visible?: boolean; tier?: string | null; obligations?: Obligation[] };
        setVisible(!!d.visible);
        setTier(d.tier ?? null);
        setObligations(d.obligations ?? []);
      } catch {
        // ignore
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded || !visible) return null;

  return (
    <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Billing &amp; Fees</h2>

      <div className="text-sm mb-3" style={{ color: "var(--color-ink)" }}>
        Tier: <strong>{tierDef(tier)?.label ?? "Not set"}</strong>
        {tierDef(tier)?.amountCents != null && (
          <span style={{ color: "var(--color-muted)" }}> · {formatCents(tierDef(tier)!.amountCents)}</span>
        )}
      </div>

      {obligations.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No fees on record.</p>
      ) : (
        <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
          {obligations.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  {o.type === "talent_tier" ? "Tier fee" : "Production access fee"}
                  {o.tier ? ` · ${tierDef(o.tier)?.label ?? o.tier}` : ""}
                </p>
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {formatCents(o.amountCents, o.currency)}{o.status === "pending" && o.graceDeadline ? ` · due ${fmtDate(o.graceDeadline)}` : ""}
                </p>
              </div>
              <span className="text-[11px] font-medium" style={{ color: o.status === "paid" ? "#166534" : "var(--color-muted)" }}>
                {STATUS_LABEL[o.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
