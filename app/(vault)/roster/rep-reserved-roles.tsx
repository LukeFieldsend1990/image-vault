"use client";

import { useEffect, useState } from "react";
import LicenceTermsSummary, { type LicenceTermsView } from "@/app/components/licence-terms-summary";

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

// Path C rep surface: reserved roles a production assigned to this agent. The rep
// supplies their client's email to connect them — the producer remains the licensee.
// Rendered on both /roster and /vault/requests; `className` tunes the outer padding
// so it sits flush with each page's content gutter.
export default function RepReservedRoles({ className = "px-8 lg:px-12 pt-6" }: { className?: string }) {
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
      <div className="space-y-4">
        {visible.map((a) => (
          <div
            key={a.castId}
            className="rounded border"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="p-5">
              {/* Reserved-role badge — parallel to the "Cast Invitation" badge on
                  the other request cards, so the requests page reads as one family. */}
              <div className="mb-3">
                <span
                  className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ background: "var(--color-accent)", color: "#fff" }}
                >
                  Reserved Role
                </span>
              </div>

              <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                {a.actorName ?? a.characterName ?? "A role"}
                {a.characterName && a.actorName ? ` · ${a.characterName}` : ""}
                {" in "}{a.productionName}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                Reserved by {a.companyName}
              </p>

              {a.hasTerms ? (
                <>
                  <div className="mt-4">
                    <LicenceTermsSummary terms={a.terms} />
                  </div>
                  <a
                    href={`/consent/cast/${a.castId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded px-4 py-2 text-xs font-medium mt-3 no-underline text-white transition"
                    style={{ background: "var(--color-accent)" }}
                  >
                    Review consent
                  </a>
                  <div className="mt-4">
                    <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>
                      Connect your client to send them this consent document.
                    </label>
                    <div className="space-y-2">
                      <input
                        type="email"
                        value={emails[a.castId] ?? ""}
                        onChange={(e) => setEmails((m) => ({ ...m, [a.castId]: e.target.value }))}
                        placeholder="Your client's email"
                        className="w-full rounded border px-3 py-2 text-sm outline-none"
                        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                      />
                      <textarea
                        value={messages[a.castId] ?? ""}
                        onChange={(e) => setMessages((m) => ({ ...m, [a.castId]: e.target.value }))}
                        placeholder="Add a personal note to your client (optional)"
                        rows={3}
                        className="w-full rounded border px-3 py-2 text-sm outline-none resize-none"
                        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)", color: "var(--color-text)" }}
                      />
                      <button
                        onClick={() => connect(a)}
                        disabled={busyId === a.castId}
                        className="rounded px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60"
                        style={{ background: "var(--color-accent)" }}
                      >
                        {busyId === a.castId ? "Connecting…" : "Connect client"}
                      </button>
                    </div>
                    {errors[a.castId] && <p className="text-xs mt-1.5" style={{ color: "var(--color-accent)" }}>{errors[a.castId]}</p>}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => decline(a)}
                      disabled={decliningId === a.castId}
                      className="text-xs disabled:opacity-50"
                      style={{ color: "var(--color-muted)", textDecoration: "underline" }}
                    >
                      {decliningId === a.castId ? "Passing…" : "Pass on this role"}
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="mt-4 rounded border p-3"
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
                      disabled={decliningId === a.castId}
                      className="text-xs disabled:opacity-50"
                      style={{ color: "var(--color-muted)", textDecoration: "underline" }}
                    >
                      {decliningId === a.castId ? "Passing…" : "Pass on this role"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
