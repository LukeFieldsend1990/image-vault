"use client";

import { useState } from "react";
import Wordmark from "@/app/components/wordmark";
import { useRouter } from "next/navigation";
import {
  COUNTRY_TOP_LEVEL,
  complianceStatement,
  hasSubPick,
  subPickList,
  subPickLabel,
  topLevelById,
} from "@/lib/jurisdictions/countries";

interface Props {
  orgId: string;
  orgName: string;
  orgType: string;
  remaining: number;
}

/**
 * Vendor / industry org country picker. Same two-step shape as the production
 * setup wizard's jurisdiction step: pick a top-level regime, pick a sub-region
 * if applicable, read the compliance statement, confirm. PATCHes the org and
 * either loops to the next pending org (when the user owns several still
 * needing a country) or lands them on the dashboard.
 */
export default function OrgOnboardingClient({ orgId, orgName, orgType, remaining }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<"pick" | "sub" | "confirm">("pick");
  const [topId, setTopId] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!topId || !sub) { setError("Pick a country to continue."); return; }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/organisations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: sub, countryTopLevelId: topId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? "Couldn't save. Try again.");
        return;
      }
      // If the user owns other orgs still needing a country, server-side
      // redirect picks the next one; otherwise they land on the dashboard.
      router.push(remaining > 1 ? "/org-onboarding" : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col justify-between px-12 py-12 lg:px-16">
        <div>
          <Wordmark variant="lock" className="text-xs" />
        </div>

        <div className="w-full max-w-md">
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "var(--color-accent)" }}>
            Set up {orgName}
          </p>

          {stage === "pick" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>
                Where is {orgName} registered?
              </h1>
              <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
                The country your {orgType === "vfx_vendor" ? "vendor" : "company"} is registered in. This sets the data-protection regime that applies to it.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {COUNTRY_TOP_LEVEL.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setTopId(c.id);
                      if (hasSubPick(c.id)) {
                        setSub(null);
                        setSearch("");
                        setStage("sub");
                      } else {
                        setSub(c.label);
                        setStage("confirm");
                      }
                    }}
                    className="text-left rounded p-3"
                    style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{c.sub}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {stage === "sub" && topId && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>
                Which {subPickLabel(topId)}?
              </h1>
              <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>Pick one — you can update this later from your organisation settings.</p>
              <input
                type="text"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block w-full mb-4 border bg-white px-4 py-3 text-sm outline-none transition focus:border-[--color-accent]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                autoComplete="off"
              />
              <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {subPickList(topId)
                  .filter((c) => !search.trim() || c.toLowerCase().includes(search.toLowerCase().trim()))
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => { setSub(c); setStage("confirm"); }}
                      className="text-left rounded px-4 py-3"
                      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                    >
                      <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c}</span>
                    </button>
                  ))}
              </div>
              <div className="mt-4">
                <button type="button" onClick={() => { setStage("pick"); setSearch(""); }} className="text-xs" style={{ color: "var(--color-muted)" }}>← Back</button>
              </div>
            </>
          )}

          {stage === "confirm" && topId && sub && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>
                Confirm {sub}
              </h1>
              <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>Please read this before confirming.</p>
              <div className="rounded p-4 mb-4" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>Country of registration</p>
                <p className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>{sub}</p>
                <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>{topLevelById(topId)?.sub}</p>
              </div>
              <div className="rounded p-4 mb-6" style={{ background: "rgba(192,57,43,0.04)", border: "1px solid rgba(192,57,43,0.15)" }}>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                  {complianceStatement(topId, sub)}
                </p>
              </div>
              {error && <p className="text-sm mb-4" style={{ color: "var(--color-accent)" }}>{error}</p>}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="rounded px-5 py-2 text-sm font-medium text-white"
                  style={{ background: busy ? "var(--color-muted)" : "var(--color-accent)", cursor: busy ? "not-allowed" : "pointer" }}
                >
                  {busy ? "Saving…" : `Confirm and continue`}
                </button>
                <button
                  type="button"
                  onClick={() => setStage(hasSubPick(topId) ? "sub" : "pick")}
                  className="rounded px-4 py-2 text-sm"
                  style={{ color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          &copy; {new Date().getFullYear()} ImageVault. All rights reserved.
        </p>
      </div>

      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16" style={{ background: "var(--color-sidebar)" }}>
        <div />
        <div>
          <p className="text-3xl font-light leading-snug tracking-tight" style={{ color: "var(--color-sidebar-fg)" }}>
            One detail before you start.
          </p>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
            We need to know where {orgName} is registered so we apply the right data-protection regime to your work — and so productions you join know the jurisdictions their performer data passes through.
          </p>
        </div>
        <div />
      </div>
    </div>
  );
}
