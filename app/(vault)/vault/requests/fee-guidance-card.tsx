"use client";

import { useEffect, useState } from "react";

interface FeeGuidance {
  text: string;
  p25: number;
  p75: number;
  median: number;
  count: number;
}

interface Props {
  licenceType: string;
  territory: string | null;
  exclusivity: string | null;
  proposedFee: number | null;
}

function formatPence(pence: number): string {
  return `\u00a3${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0 })}`;
}

export default function FeeGuidanceCard({ licenceType, territory, exclusivity, proposedFee }: Props) {
  const [guidance, setGuidance] = useState<FeeGuidance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("licenceType", licenceType);
    if (territory) params.set("territory", territory);
    if (exclusivity) params.set("exclusivity", exclusivity);
    if (proposedFee !== null) params.set("proposedFee", String(proposedFee));

    fetch(`/api/ai/fee-guidance?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setGuidance((data as FeeGuidance | null) ?? null))
      .catch(() => setGuidance(null))
      .finally(() => setLoading(false));
  }, [licenceType, territory, exclusivity, proposedFee]);

  if (loading) {
    return (
      <div
        className="rounded-md border-l-4 p-4 space-y-2 animate-pulse"
        style={{
          borderLeftColor: "#3b82f6",
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <div className="h-3 w-28 rounded" style={{ backgroundColor: "var(--color-border)" }} />
        <div className="h-3 w-full rounded" style={{ backgroundColor: "var(--color-border)" }} />
        <div className="h-3 w-3/4 rounded" style={{ backgroundColor: "var(--color-border)" }} />
        <div className="h-3 w-1/2 rounded" style={{ backgroundColor: "var(--color-border)" }} />
      </div>
    );
  }

  if (!guidance) return null;

  return (
    <div
      className="rounded-md border border-l-4 p-4 space-y-2"
      style={{
        borderLeftColor: "#3b82f6",
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      <p
        className="text-xs font-medium tracking-wide uppercase"
        style={{ color: "var(--color-muted)" }}
      >
        Platform Insight
      </p>

      <p className="text-sm leading-relaxed" style={{ color: "var(--color-ink)" }}>
        {guidance.text}
      </p>

      <div className="text-xs space-y-0.5 pt-1" style={{ color: "var(--color-ink)" }}>
        <p>
          Typical range: {formatPence(guidance.p25)} &ndash; {formatPence(guidance.p75)}
        </p>
        <p>Median: {formatPence(guidance.median)}</p>
        <p style={{ color: "var(--color-muted)" }}>
          Based on {guidance.count} comparable licence{guidance.count === 1 ? "" : "s"}
        </p>
      </div>

      <p className="text-[11px] pt-1" style={{ color: "var(--color-muted)" }}>
        For guidance only &mdash; not financial advice
      </p>
    </div>
  );
}
