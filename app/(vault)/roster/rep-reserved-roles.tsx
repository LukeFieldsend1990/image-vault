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
export default function RepReservedRoles() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/cast/rep-assignments")
      .then((r) => r.json() as Promise<{ assignments?: Assignment[] }>)
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
  }, []);

  async function connect(a: Assignment) {
    const email = (emails[a.castId] ?? "").trim();
    if (!email) { setErrors((e) => ({ ...e, [a.castId]: "Enter your client's email." })); return; }
    setBusyId(a.castId);
    setErrors((e) => ({ ...e, [a.castId]: "" }));
    try {
      const r = await fetch(`/api/productions/${a.productionId}/cast/${a.castId}/rep-resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
    <div className="px-8 lg:px-12 pt-6">
      <div className="rounded border px-5 py-4" style={{ borderColor: "var(--color-accent)", background: "color-mix(in srgb, var(--color-accent) 5%, var(--color-bg))" }}>
        <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-accent)" }}>
          {visible.length === 1 ? "A production reserved a role for your client" : `${visible.length} reserved roles for your clients`}
        </p>
        <div className="space-y-2">
          {visible.map((a) => (
            <div key={a.castId} className="rounded px-3 py-3" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                <span className="font-medium">{a.actorName ?? a.characterName ?? "A role"}</span>
                {a.characterName && a.actorName ? ` · ${a.characterName}` : ""}
                {" in "}<span className="font-medium">{a.productionName}</span>
              </p>
              <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>Reserved by {a.companyName}</p>
              {a.hasTerms ? (
                <>
                  <div className="mb-3">
                    <LicenceTermsSummary terms={a.terms} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={emails[a.castId] ?? ""}
                      onChange={(e) => setEmails((m) => ({ ...m, [a.castId]: e.target.value }))}
                      placeholder="Your client's email"
                      className="flex-1"
                      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "6px 10px", fontSize: 13, color: "var(--color-text)", outline: "none" }}
                    />
                    <button
                      onClick={() => connect(a)}
                      disabled={busyId === a.castId}
                      className="text-xs font-medium px-3 py-2 rounded text-white shrink-0"
                      style={{ background: "var(--color-accent)", opacity: busyId === a.castId ? 0.6 : 1 }}
                    >
                      {busyId === a.castId ? "Connecting…" : "Connect client"}
                    </button>
                  </div>
                  {errors[a.castId] && <p className="text-xs mt-1" style={{ color: "var(--color-accent)" }}>{errors[a.castId]}</p>}
                </>
              ) : (
                <div className="flex items-start justify-between gap-3 rounded px-3 py-2" style={{ background: "var(--color-bg)", border: "1px dashed var(--color-border)" }}>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {a.companyName} hasn&rsquo;t shared intended use or licence dates for this role yet. Ask them to add the terms before you connect your client.
                  </p>
                  {a.coordinatorEmail && (
                    <a
                      href={`mailto:${a.coordinatorEmail}?subject=${encodeURIComponent(`Licence terms needed for ${a.characterName ?? a.actorName ?? "reserved role"} in ${a.productionName}`)}&body=${encodeURIComponent(`Hi,\n\nBefore I can connect my client to ${a.characterName ?? a.actorName ?? "the reserved role"} on ${a.productionName}, could you add the intended use and licence dates to the role on Image Vault?\n\nThanks.`)}`}
                      className="text-xs font-medium px-3 py-2 rounded text-white shrink-0 no-underline"
                      style={{ background: "var(--color-accent)" }}
                    >
                      Email {a.companyName}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
