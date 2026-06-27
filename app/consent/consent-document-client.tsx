"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";
import type { ConsentDocViewModel } from "@/lib/consent/load";

type Source = { kind: "licence"; id: string } | { kind: "token"; token: string };

interface DocResponse {
  document: ConsentDocViewModel;
  canAct: boolean;
  actingRole?: "talent" | "rep" | null;
}

const ACCENT = "var(--color-accent)";

export default function ConsentDocumentClient({ source }: { source: Source }) {
  const [data, setData] = useState<DocResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const docEndpoint = source.kind === "licence" ? `/api/consent/${source.id}/document` : `/api/consent/access/${source.token}`;
  const acceptEndpoint = source.kind === "licence" ? `/api/consent/${source.id}/accept` : `/api/consent/access/${source.token}/accept`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(docEndpoint);
        const d = (await r.json()) as DocResponse & { error?: string };
        if (cancelled) return;
        if (!r.ok) { setLoadError(d.error ?? "Could not load this consent document."); return; }
        setData(d);
        setConsents(new Set(d.document.currentConsents));
        if (d.document.alreadyAccepted) setDone(true);
      } catch {
        if (!cancelled) setLoadError("Network error. Please try again.");
      }
    })();
    return () => { cancelled = true; };
  }, [docEndpoint]);

  const toggle = useCallback((id: string) => {
    setConsents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const vm = data?.document;
  const consentedList = useMemo(() => USE_CATEGORIES.filter((c) => consents.has(c.id)), [consents]);

  const submit = useCallback(async () => {
    if (!attested) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(acceptEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uses: [...consents], attested: true }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not record your consent."); return; }
      setDone(true);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [acceptEndpoint, attested, consents]);

  if (loadError) {
    return (
      <Frame>
        <div className="rounded p-6 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>This consent document isn&apos;t available</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{loadError}</p>
        </div>
      </Frame>
    );
  }
  if (!vm) {
    return <Frame><div className="py-20 text-center text-sm" style={{ color: "var(--color-muted)" }}>Loading…</div></Frame>;
  }

  const total = USE_CATEGORIES.length;
  const isGuest = source.kind === "token";

  // ── Signed / done state ─────────────────────────────────────────────────────
  if (done) {
    return (
      <Frame>
        <div className="rounded-xl p-6 mb-5" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.04)" }}>
          <div className="flex items-start gap-3">
            <CheckCircle />
            <div>
              <h2 className="text-lg font-medium mb-1" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>
                Thank you, {firstName(vm.performerName)}.
              </h2>
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                You&apos;ve consented to <strong style={{ color: "var(--color-text)" }}>{consentedList.length}</strong> of{" "}
                <strong style={{ color: "var(--color-text)" }}>{total}</strong> uses of your biometric data on {vm.productionName}.
                {" "}The production has been notified.
              </p>
            </div>
          </div>
        </div>

        <SectionLabel>What you consented to</SectionLabel>
        <div className="rounded-lg p-4 mb-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          {USE_CATEGORIES.map((c) => {
            const on = consents.has(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2.5 py-1.5 text-sm" style={{ color: on ? "var(--color-text)" : "var(--color-muted)" }}>
                <span style={{ color: on ? "#166534" : "var(--color-border)" }}>{on ? "✓" : "—"}</span>
                <span>{c.name}</span>
              </div>
            );
          })}
        </div>

        {/* Gentle conversion */}
        <div className="rounded-xl p-6" style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>You&apos;re done</p>
          <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>
            Your consent is recorded. You can leave it there.
          </h2>
          <p className="text-sm mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            {vm.companyName} holds your vault for {vm.productionName} with exactly the access you consented to, and nothing more.
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            Whenever you&apos;re ready — now or any time later — you can register on ImageVault and take ownership of the vault yourself.
            You&apos;d then decide who else can access your data, withdraw consent instantly, and set standing instructions that apply to every
            future request. Registration is free and takes about three minutes.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {isGuest && (
              <Link href="/signup" className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>
                Set up my account
              </Link>
            )}
            <Link
              href="/imagevault-for-performers"
              className="rounded px-4 py-2 text-sm font-medium"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            >
              {isGuest ? "Tell me more first" : "What is ImageVault for performers?"}
            </Link>
          </div>
        </div>
      </Frame>
    );
  }

  // ── Document state ──────────────────────────────────────────────────────────
  const canAct = data.canAct;
  return (
    <Frame>
      {data.actingRole === "rep" && (
        <div className="rounded-lg p-3 mb-5 flex items-start gap-2.5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <span style={{ color: ACCENT }}>◆</span>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            You&apos;re reviewing this as <strong style={{ color: "var(--color-text)" }}>{firstName(vm.performerName)}&apos;s agent</strong>.
            Confirming here records consent on their behalf, per your standing authority.
          </p>
        </div>
      )}

      <header className="mb-7">
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>{vm.copy.kicker}</p>
        <h1 className="text-2xl font-medium mb-3" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)", lineHeight: 1.2 }}>
          {vm.copy.title}
        </h1>
        <p className="text-sm mb-5" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>{vm.copy.lead}</p>
        <div className="grid grid-cols-2 gap-y-3 gap-x-6 rounded-lg p-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <Meta k="Sent to" v={vm.performerName} />
          <Meta k="Production" v={vm.productionName} />
          <Meta k="Production company" v={vm.companyName} />
          <Meta k="Document version" v={vm.copy.version} />
        </div>
      </header>

      {vm.copy.before.map((s) => <DocSection key={s.num} s={s} />)}

      {/* Interactive consent picker */}
      <section className="mb-7">
        <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: "var(--color-muted)" }}>Section {vm.copy.consentSection.num}</p>
        <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>{vm.copy.consentSection.heading}</h2>
        <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>{vm.copy.consentSection.intro}</p>
        <div className="space-y-2.5">
          {USE_CATEGORIES.map((c) => {
            const on = consents.has(c.id);
            const requested = vm.requestedScope.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={!canAct}
                onClick={() => canAct && toggle(c.id)}
                className="w-full flex items-start gap-3 rounded-lg p-3.5 text-left transition"
                style={{
                  border: `1px solid ${on ? ACCENT : "var(--color-border)"}`,
                  background: on ? "rgba(192,57,43,0.04)" : "var(--color-bg)",
                  cursor: canAct ? "pointer" : "default",
                  opacity: canAct ? 1 : 0.85,
                }}
              >
                <span
                  className="mt-0.5 flex items-center justify-center rounded shrink-0"
                  style={{ width: 18, height: 18, border: `1px solid ${on ? ACCENT : "var(--color-border)"}`, background: on ? ACCENT : "transparent", color: "white", fontSize: 12 }}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{c.name}</span>
                    {c.regimeTag && <Pill bg="var(--color-surface)" color="var(--color-muted)" border>{c.regimeTag}</Pill>}
                    {c.sensitive && <Pill bg="rgba(180,83,9,0.1)" color="#b45309">sensitive</Pill>}
                    {requested && <Pill bg="rgba(192,57,43,0.1)" color="var(--color-accent)">requested</Pill>}
                  </span>
                  <span className="block text-sm mt-1" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>{c.description}</span>
                  <span className="block text-xs mt-1.5 italic" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>{c.example}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {vm.copy.after.map((s) => <DocSection key={s.num} s={s} />)}

      {/* Dynamic summary */}
      <div className="rounded-xl p-5 mb-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>In summary</p>
        <p className="text-sm mb-1" style={{ color: "var(--color-text)" }}>
          You are about to consent to <strong>{consentedList.length}</strong> of <strong>{total}</strong> uses on {vm.productionName}:
        </p>
        {consentedList.length > 0 ? (
          <ul className="list-disc pl-5 mt-2 space-y-0.5">
            {consentedList.map((c) => <li key={c.id} className="text-sm" style={{ color: "var(--color-text)" }}>{c.name}</li>)}
          </ul>
        ) : (
          <p className="text-sm italic mt-1" style={{ color: "var(--color-muted)" }}>No uses ticked. You can confirm with nothing ticked to refuse consent entirely.</p>
        )}
      </div>

      {/* Attestation + confirm */}
      {canAct ? (
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
          <button
            type="button"
            onClick={() => setAttested((a) => !a)}
            className="w-full flex items-start gap-3 text-left mb-4"
          >
            <span
              className="mt-0.5 flex items-center justify-center rounded shrink-0"
              style={{ width: 18, height: 18, border: `1px solid ${attested ? ACCENT : "var(--color-border)"}`, background: attested ? ACCENT : "transparent", color: "white", fontSize: 12 }}
            >
              {attested ? "✓" : ""}
            </span>
            <span className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>{vm.copy.attestation}</span>
          </button>
          {submitError && <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: ACCENT, border: "1px solid rgba(192,57,43,0.2)" }}>{submitError}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={!attested || submitting}
            className="w-full rounded px-4 py-2.5 text-sm font-medium text-white transition"
            style={{ background: !attested || submitting ? "var(--color-muted)" : ACCENT, cursor: !attested || submitting ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Confirming…" : "Confirm consent"}
          </button>
          <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-muted)" }}>
            Recorded with timestamp and document version. No signature required.
          </p>
        </div>
      ) : (
        <div className="rounded-lg p-4 text-center text-sm" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
          This consent has already been confirmed.
        </div>
      )}
    </Frame>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      <div className="mx-auto px-5 py-10" style={{ maxWidth: 720 }}>{children}</div>
    </div>
  );
}

function DocSection({ s }: { s: { num: string; heading: string; paragraphs: string[]; emphasis?: string } }) {
  return (
    <section className="mb-7">
      <p className="text-xs font-mono uppercase tracking-wider mb-1" style={{ color: "var(--color-muted)" }}>Section {s.num}</p>
      <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>{s.heading}</h2>
      {s.paragraphs.map((p, i) => (
        <p key={i} className="text-sm mb-2" style={{ color: "var(--color-muted)", lineHeight: 1.65 }}>{p}</p>
      ))}
      {s.emphasis && (
        <div className="rounded-lg p-3.5 mt-2 text-sm" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)", lineHeight: 1.6 }}>
          {s.emphasis}
        </div>
      )}
    </section>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider mb-0.5" style={{ color: "var(--color-muted)" }}>{k}</p>
      <p className="text-sm" style={{ color: "var(--color-text)" }}>{v}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>{children}</p>;
}

function Pill({ children, bg, color, border }: { children: React.ReactNode; bg: string; color: string; border?: boolean }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: bg, color, border: border ? "1px solid var(--color-border)" : undefined, fontFamily: "var(--font-mono, monospace)" }}>
      {children}
    </span>
  );
}

function CheckCircle() {
  return (
    <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 28, height: 28, background: ACCENT, color: "white", fontSize: 15 }}>✓</span>
  );
}

function firstName(name: string): string {
  return name.split(" ")[0] || name;
}
