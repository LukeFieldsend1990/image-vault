"use client";

import { useEffect, useState } from "react";
import {
  humaniseUseType,
  exclusivityLabel,
  type LicenceTermsView,
} from "@/app/components/licence-terms-summary";

interface Assignment {
  castId: string;
  productionId: string;
  actorName: string | null;
  characterName: string | null;
  productionName: string;
  companyName: string;
  hasTerms: boolean;
  terms?: LicenceTermsView;
  coordinatorEmail: string | null;
}

function fmtMoney(pence: number): string {
  return `$${(pence / 100).toLocaleString()}`;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Path C rep surface: reserved roles a production assigned to this agent. The rep
// supplies their client's email to connect them — the producer remains the licensee.
// Rendered on /vault/requests and at the top of the productions surface (own page
// and the roster tab); /roster shows a slim banner pointing to Requests.
// Styling mirrors the talent CastRequestCard (dashed = not yet agreed), so the
// request surfaces read as one family.
export default function RepReservedRoles({ className = "mb-4" }: { className?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/cast/rep-assignments")
      .then((r) => r.json() as Promise<{ assignments?: Assignment[] }>)
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
  }, []);

  async function decline(a: Assignment) {
    if (!window.confirm(`Pass on the role of ${a.characterName ?? a.actorName ?? "this role"} in ${a.productionName}? The production will be notified so they can reassign it.`)) return;
    setDecliningId(a.castId);
    try {
      const r = await fetch(`/api/productions/${a.productionId}/cast/${a.castId}/rep-decline`, { method: "POST" });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setErrors((e) => ({ ...e, [a.castId]: d.error ?? "Couldn't decline the role." })); return; }
      setDoneIds((prev) => new Set(prev).add(a.castId));
    } catch {
      setErrors((e) => ({ ...e, [a.castId]: "Network error. Please try again." }));
    } finally {
      setDecliningId(null);
    }
  }

  async function connect(a: Assignment) {
    const email = (emails[a.castId] ?? "").trim();
    if (!email) { setErrors((e) => ({ ...e, [a.castId]: "Enter your client's email." })); return; }
    setBusyId(a.castId);
    setErrors((e) => ({ ...e, [a.castId]: "" }));
    try {
      const r = await fetch(`/api/productions/${a.productionId}/cast/${a.castId}/rep-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message: (messages[a.castId] ?? "").trim() || undefined }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setErrors((e) => ({ ...e, [a.castId]: d.error ?? "Couldn't connect your client." })); return; }
      setDoneIds((prev) => new Set(prev).add(a.castId));
    } catch {
      setErrors((e) => ({ ...e, [a.castId]: "Network error. Please try again." }));
    } finally {
      setBusyId(null);
    }
  }

  const visible = assignments.filter((a) => !doneIds.has(a.castId));
  if (visible.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-center gap-3 mb-4">
        <div
          className="h-1.5 w-1.5 rounded-full shrink-0 animate-pulse"
          style={{ background: "var(--color-accent)" }}
        />
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-accent)" }}>
          {visible.length === 1
            ? "1 reserved role — connect your client"
            : `${visible.length} reserved roles — connect your clients`}
        </p>
      </div>
      <div className="space-y-4">
        {visible.map((a) => {
          const role = a.characterName ?? a.actorName ?? "a reserved role";
          const terms = a.terms;
          const year = typeof terms?.validFrom === "number" ? new Date(terms.validFrom * 1000).getFullYear() : null;
          const types = (terms?.licenceTypes?.length ? terms.licenceTypes : terms?.licenceType ? [terms.licenceType] : [])
            .filter((t): t is string => Boolean(t));
          const hasWindow = typeof terms?.validFrom === "number" && typeof terms?.validTo === "number";
          const busy = busyId === a.castId;
          const declining = decliningId === a.castId;
          return (
            <article
              key={a.castId}
              className="rounded-lg overflow-hidden"
              style={{ border: "2px dashed rgba(180,83,9,0.45)", background: "rgba(180,83,9,0.03)" }}
            >
              {/* Request banner */}
              <div
                className="px-6 py-2.5 flex items-center justify-between gap-3"
                style={{ background: "rgba(180,83,9,0.09)", borderBottom: "1px dashed rgba(180,83,9,0.25)" }}
              >
                <div className="flex items-center gap-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#b45309" }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#b45309" }}>
                    Reserved role — client not yet connected
                  </span>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "#b45309" }}>
                  {a.hasTerms ? "Awaiting your client" : "Awaiting licence terms"}
                </span>
              </div>

              {/* Production summary */}
              <div className="px-6 pt-5 pb-5">
                {year && (
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
                    {year}
                  </p>
                )}

                <div className="flex items-start justify-between gap-6 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-xl font-semibold tracking-tight leading-none" style={{ color: "var(--color-ink)" }}>
                      {a.productionName}
                    </h3>
                    <p className="mt-1.5 text-sm" style={{ color: "var(--color-muted)" }}>{a.companyName}</p>
                  </div>
                  {terms?.proposedFee != null && (
                    <div className="text-right shrink-0">
                      <p className="text-lg font-semibold tabular-nums" style={{ color: "#b45309" }}>
                        {fmtMoney(terms.proposedFee)}
                      </p>
                      <p className="text-[10px] uppercase tracking-widest" style={{ color: "#b45309" }}>
                        Proposed
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span
                    className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm"
                    style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)" }}
                  >
                    Reserved for your client
                  </span>
                  {(a.actorName || a.characterName) && (
                    <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                      {a.actorName && <span className="font-medium" style={{ color: "var(--color-text)" }}>{a.actorName}</span>}
                      {a.characterName && (
                        <>
                          {a.actorName ? " as " : "as "}
                          <span className="font-medium" style={{ color: "var(--color-text)" }}>{a.characterName}</span>
                        </>
                      )}
                    </span>
                  )}
                </div>

                {a.hasTerms ? (
                  <>
                    {/* Tags row */}
                    {(types.length > 0 || terms?.territory || (terms?.exclusivity && terms.exclusivity !== "non_exclusive") || terms?.isRelicense) && (
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {types.map((t) => (
                          <span
                            key={t}
                            className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm"
                            style={{ background: "rgba(180,83,9,0.08)", color: "#b45309" }}
                          >
                            {humaniseUseType(t)}
                          </span>
                        ))}
                        {terms?.territory && (
                          <span
                            className="inline-flex text-[10px] font-medium px-2.5 py-1 rounded-sm"
                            style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                          >
                            {terms.territory}
                          </span>
                        )}
                        {terms?.exclusivity && terms.exclusivity !== "non_exclusive" && (
                          <span
                            className="inline-flex text-[10px] font-medium px-2.5 py-1 rounded-sm"
                            style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
                          >
                            {exclusivityLabel(terms.exclusivity)}
                          </span>
                        )}
                        {terms?.isRelicense && (
                          <span
                            className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm text-white"
                            style={{ background: "var(--color-accent)" }}
                          >
                            Relicense
                          </span>
                        )}
                      </div>
                    )}

                    {/* Licence window */}
                    {terms?.durationOfProduction ? (
                      <p className="text-sm font-medium mb-3" style={{ color: "var(--color-text)" }}>
                        Duration of production
                      </p>
                    ) : hasWindow ? (
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                          {fmtDate(terms!.validFrom as number)}
                        </span>
                        <svg width="16" height="8" viewBox="0 0 16 8" fill="none" style={{ color: "var(--color-muted)" }}>
                          <line x1="0" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="1" />
                          <polyline points="9,1 12,4 9,7" stroke="currentColor" strokeWidth="1" fill="none" />
                        </svg>
                        <span className="text-sm" style={{ color: "var(--color-muted)" }}>
                          {fmtDate(terms!.validTo as number)}
                        </span>
                      </div>
                    ) : null}

                    {/* Intended use */}
                    {terms?.intendedUse?.trim() && (
                      <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
                        <span className="font-medium" style={{ color: "var(--color-text)" }}>Usage: </span>
                        {terms.intendedUse.trim()}
                      </p>
                    )}

                    {/* Consent preview — the document the client will be asked to sign */}
                    <div className="flex items-center justify-end pt-2" style={{ borderTop: "1px solid rgba(180,83,9,0.15)" }}>
                      <a
                        href={`/consent/cast/${a.castId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide hover:opacity-80 transition-opacity no-underline"
                        style={{ color: "#b45309" }}
                      >
                        Review consent →
                      </a>
                    </div>
                  </>
                ) : (
                  <div
                    className="rounded border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                        {a.companyName} hasn&rsquo;t shared intended use or licence dates for this role yet. Ask them to add the terms before you connect your client.
                      </p>
                      {a.coordinatorEmail && (
                        <a
                          href={`mailto:${a.coordinatorEmail}?subject=${encodeURIComponent(`Licence terms needed for ${a.characterName ?? a.actorName ?? "reserved role"} in ${a.productionName}`)}&body=${encodeURIComponent(`Hi,\n\nBefore I can connect my client to ${a.characterName ?? a.actorName ?? "the reserved role"} on ${a.productionName}, could you add the intended use and licence dates to the role on ImageVault?\n\nThanks.`)}`}
                          className="rounded px-4 py-2 text-xs font-medium text-white shrink-0 no-underline"
                          style={{ background: "var(--color-accent)" }}
                        >
                          Email {a.companyName}
                        </a>
                      )}
                    </div>
                    {errors[a.castId] && <p className="text-xs mt-2" style={{ color: "var(--color-accent)" }}>{errors[a.castId]}</p>}
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                      <button
                        type="button"
                        onClick={() => decline(a)}
                        disabled={declining}
                        className="text-xs disabled:opacity-50"
                        style={{ color: "var(--color-muted)", textDecoration: "underline" }}
                      >
                        {declining ? "Passing…" : "Pass on this role"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Connect form */}
              {a.hasTerms && (
                <div
                  className="px-6 py-4"
                  style={{ borderTop: "1px dashed rgba(180,83,9,0.25)", background: "var(--color-surface)" }}
                >
                  <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                    {a.companyName} reserved the role of <span className="font-medium" style={{ color: "var(--color-text)" }}>{role}</span> for your client.
                    Enter their email to connect them — if they&apos;re not on ImageVault yet, we&apos;ll send them a signup link.
                  </p>
                  <div className="space-y-2">
                    <input
                      type="email"
                      value={emails[a.castId] ?? ""}
                      onChange={(e) => setEmails((m) => ({ ...m, [a.castId]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") connect(a); }}
                      placeholder="Your client's email address"
                      disabled={busy}
                      className="w-full rounded border px-3 py-2 text-sm outline-none"
                      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                    />
                    <textarea
                      value={messages[a.castId] ?? ""}
                      onChange={(e) => setMessages((m) => ({ ...m, [a.castId]: e.target.value }))}
                      placeholder="Add a personal note to your client (optional)"
                      disabled={busy}
                      rows={3}
                      className="w-full rounded border px-3 py-2 text-sm outline-none resize-none"
                      style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                    />
                    <button
                      onClick={() => connect(a)}
                      disabled={busy}
                      className="rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60"
                      style={{ background: "var(--color-accent)" }}
                    >
                      {busy ? "Connecting…" : "Connect client"}
                    </button>
                  </div>
                  {errors[a.castId] && <p className="text-xs mt-1.5" style={{ color: "var(--color-accent)" }}>{errors[a.castId]}</p>}
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <button
                      type="button"
                      onClick={() => decline(a)}
                      disabled={declining || busy}
                      className="text-xs disabled:opacity-50"
                      style={{ color: "var(--color-muted)", textDecoration: "underline" }}
                    >
                      {declining ? "Passing…" : "Pass on this role"}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
