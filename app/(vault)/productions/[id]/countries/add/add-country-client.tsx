"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  COUNTRY_TOP_LEVEL,
  complianceStatement,
  hasSubPick,
  subPickLabel,
  subPickList,
  topLevelById,
} from "@/lib/jurisdictions/countries";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 14,
  color: "var(--color-text)",
  outline: "none",
};

export default function AddCountryClient({ productionId }: { productionId: string }) {
  const router = useRouter();
  const [productionName, setProductionName] = useState<string>("the production");
  const [step, setStep] = useState<"pick" | "sub" | "confirm">("pick");
  const [topLevel, setTopLevel] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/productions/${productionId}`)
      .then((r) => r.ok ? r.json() as Promise<{ production?: { name?: string } }> : null)
      .then((d) => {
        if (d?.production?.name) setProductionName(d.production.name);
      })
      .catch(() => {});
  }, [productionId]);

  function pickTopLevel(id: string) {
    setTopLevel(id);
    setError("");
    if (hasSubPick(id)) {
      setSub(null);
      setSearch("");
      setStep("sub");
    } else {
      // Top-level is the picked country itself (UK, CH, etc.)
      const label = topLevelById(id)?.label ?? id;
      setSub(label);
      setStep("confirm");
    }
  }

  async function confirm() {
    if (!topLevel || !sub) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`/api/productions/${productionId}/countries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sub, topLevelId: topLevel }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? "Couldn't add the country.");
        return;
      }
      router.push(`/productions/${productionId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const subList = topLevel ? subPickList(topLevel) : [];
  const q = search.toLowerCase().trim();
  const filtered = q ? subList.filter((c) => c.toLowerCase().includes(q)) : subList;

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-4">
        <Link href={`/productions/${productionId}`} className="text-xs" style={{ color: "var(--color-muted)" }}>
          ← Back to {productionName}
        </Link>
      </div>

      <p className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--color-muted)" }}>
        Add a country to {productionName}
      </p>

      {step === "pick" && (
        <div className="space-y-5">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              Which country are you adding?
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
              Pick the country, region, or jurisdiction. We&apos;ll show you the compliance commitment in the next step.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {COUNTRY_TOP_LEVEL.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickTopLevel(c.id)}
                className="text-left rounded p-4 transition-colors hover:border-[var(--color-accent)]"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{c.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "sub" && topLevel && (
        <div className="space-y-5">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              Which {subPickLabel(topLevel)}?
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
              Pick one. You can come back and add more in separate steps.
            </p>
          </div>
          <input
            type="text"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, maxWidth: 360 }}
            autoComplete="off"
          />
          <div className="grid sm:grid-cols-2 gap-2">
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setSub(c); setStep("confirm"); }}
                className="text-left rounded px-4 py-3 transition-colors hover:border-[var(--color-accent)]"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              >
                <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm col-span-2 px-1" style={{ color: "var(--color-muted)" }}>
                No matches for &quot;{search}&quot;.
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => { setStep("pick"); setSearch(""); }}
              className="rounded px-4 py-2 text-sm"
              style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && topLevel && sub && (
        <div className="space-y-5">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
              Add {sub} to {productionName}?
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>Please read this before confirming.</p>
          </div>
          <div className="rounded p-4" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
            <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>Country</p>
            <p className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>{sub}</p>
          </div>
          <div className="rounded p-4" style={{ background: "rgba(192,57,43,0.04)", border: "1px solid rgba(192,57,43,0.15)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
              {complianceStatement(topLevel, sub)}
            </p>
          </div>
          {error && (
            <p className="text-sm rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="rounded px-5 py-2 text-sm font-medium text-white"
              style={{ background: busy ? "var(--color-muted)" : "var(--color-accent)", cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy ? "Adding…" : `Confirm and add ${sub}`}
            </button>
            <button
              type="button"
              onClick={() => setStep(hasSubPick(topLevel) ? "sub" : "pick")}
              className="rounded px-4 py-2 text-sm"
              style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
