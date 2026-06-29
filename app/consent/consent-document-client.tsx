"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { USE_CATEGORIES } from "@/lib/consent/use-categories";
import type { ConsentDocViewModel } from "@/lib/consent/load";

type Source =
  | { kind: "licence"; id: string }
  | { kind: "token"; token: string }
  | { kind: "preview"; castId: string }
  // Actionable cast surface: the reserved rep (and the production) pre-negotiate
  // the §39 scope on a production-held placeholder, then the rep sends it for
  // final consent. No final acceptance happens here.
  | { kind: "cast"; castId: string };

interface DocResponse {
  document: ConsentDocViewModel;
  canAct: boolean;
  actingRole?: "talent" | "rep" | null;
}

interface NegotiationRound {
  id: string;
  round: number;
  party: "producer" | "talent" | "rep";
  action: "counter" | "accepted" | "declined";
  scope: string[];
  fee: number | null;
  comment: string | null;
  createdAt: number;
}
interface NegotiationState {
  party: "producer" | "talent" | "rep" | "admin" | null;
  currentOffer: { scope: string[]; fee: number | null };
  rounds: NegotiationRound[];
  pendingTalentCounter: NegotiationRound | null;
  closed: boolean;
}

function feeLabel(pence: number | null): string {
  if (pence == null) return "No fee (N/A)";
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function parseFeeInput(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function scopeNames(ids: string[]): string {
  return USE_CATEGORIES.filter((c) => ids.includes(c.id)).map((c) => c.name).join(", ") || "no uses";
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
  const [withdrawn, setWithdrawn] = useState(false);

  // Negotiation (registered/licence mode only — guests can't negotiate pre-account)
  const [nego, setNego] = useState<NegotiationState | null>(null);
  const [counterMode, setCounterMode] = useState(false);
  const [counterFee, setCounterFee] = useState("");
  const [counterComment, setCounterComment] = useState("");
  const [negoBusy, setNegoBusy] = useState(false);
  // Performer explicitly chose to propose new terms without changing the ticked
  // uses (e.g. proposing only a fee/note). Changing the uses opens the same form
  // automatically, so this is only needed for the "same scope, different terms" case.
  const [proposeIntent, setProposeIntent] = useState(false);

  // Cast mode: rep sends the negotiated document to their client for final consent.
  const [sendMode, setSendMode] = useState(false);
  const [sendEmailVal, setSendEmailVal] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Token mode: the performer's custody election after confirming consent.
  const [custodyChoice, setCustodyChoice] = useState<"self" | "rep_managed" | null>(null);
  const [custodyBusy, setCustodyBusy] = useState(false);

  // Preview mode: a reserved-role agent reads the document before connecting their
  // client. Read-only — no acceptance, no negotiation, no account exists yet.
  const isPreview = source.kind === "preview";
  const isCast = source.kind === "cast";
  const token = source.kind === "token" ? source.token : null;
  const licenceId = source.kind === "licence" ? source.id : null;
  const docEndpoint =
    source.kind === "licence"
      ? `/api/consent/${source.id}/document`
      : source.kind === "preview"
        ? `/api/consent/preview/${source.castId}`
        : source.kind === "cast"
          ? `/api/consent/cast/${source.castId}/document`
          : `/api/consent/access/${source.token}`;
  const acceptEndpoint = source.kind === "licence" ? `/api/consent/${source.id}/accept` : source.kind === "token" ? `/api/consent/access/${source.token}/accept` : "";
  // Negotiation thread base — shared by licence mode and the actionable cast mode.
  const negoBase =
    source.kind === "licence" ? `/api/consent/${source.id}`
      : source.kind === "cast" ? `/api/consent/cast/${source.castId}`
        : null;

  const refreshNego = useCallback(async () => {
    if (!negoBase) return;
    try {
      const r = await fetch(`${negoBase}/negotiation`);
      if (r.ok) setNego((await r.json()) as NegotiationState);
    } catch { /* non-fatal */ }
  }, [negoBase]);
  useEffect(() => { void refreshNego(); }, [refreshNego]);

  // Once both the document and the negotiation thread have loaded, reflect the
  // performer's latest open proposal in the document body — not just the
  // negotiation-history panel. Without this the use-category checklist and the
  // "In summary" block stay anchored to the licence's stored scope, so a use the
  // performer has just proposed (e.g. AI training) appears in the history but is
  // missing from the agreement itself. One-shot on load so it never clobbers the
  // viewer's own edits or a post-action refresh.
  const negoSeededRef = useRef(false);
  useEffect(() => {
    if (negoSeededRef.current) return;
    if (!data || !nego) return; // wait for both before deciding the seed
    negoSeededRef.current = true;
    if (nego.pendingTalentCounter && !data.document.alreadyAccepted) {
      setConsents(new Set(nego.pendingTalentCounter.scope));
    }
  }, [data, nego]);

  async function sendCounter() {
    if (!negoBase) return;
    setNegoBusy(true); setSubmitError(null);
    try {
      const r = await fetch(`${negoBase}/counter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: [...consents], fee: parseFeeInput(counterFee), comment: counterComment }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not send the counter-offer."); return; }
      setCounterMode(false); setCounterComment(""); setCounterFee(""); setProposeIntent(false);
      await refreshNego();
    } finally { setNegoBusy(false); }
  }

  async function acceptCounter() {
    if (!negoBase) return;
    setNegoBusy(true); setSubmitError(null);
    try {
      const r = await fetch(`${negoBase}/negotiation/accept`, { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not accept the counter-offer."); return; }
      await refreshNego();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } finally { setNegoBusy(false); }
  }

  async function withdraw() {
    if (!licenceId) return;
    const reason = typeof window !== "undefined"
      ? window.prompt("Withdraw your consent for this production? This stops new uses going forward. Optionally add a reason:")
      : "";
    if (reason === null) return; // cancelled
    setNegoBusy(true);
    try {
      const r = await fetch(`/api/consent/${licenceId}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (r.ok) setWithdrawn(true);
    } finally { setNegoBusy(false); }
  }

  // Cast mode: rep sends the negotiated consent document to their client by email.
  async function sendForConsent() {
    if (source.kind !== "cast" || !vm?.productionId) return;
    const email = sendEmailVal.trim();
    if (!email) { setSubmitError("Enter your client's email."); return; }
    setNegoBusy(true); setSubmitError(null);
    try {
      const r = await fetch(`/api/productions/${vm.productionId}/cast/${source.castId}/consent-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, send: true }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; email?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not send the consent document."); return; }
      setSentTo(d.email ?? email);
      setSendMode(false);
    } finally { setNegoBusy(false); }
  }

  // Token mode: record the performer's custody election. "self" → register & take
  // custody; "rep_managed" → leave production-held, managed by their rep.
  async function chooseCustody(choice: "self" | "rep_managed") {
    if (!token) return;
    setCustodyBusy(true);
    try {
      await fetch(`/api/consent/access/${token}/custody`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      }).catch(() => {});
      setCustodyChoice(choice);
      if (choice === "self" && typeof window !== "undefined") window.location.href = "/signup";
    } finally { setCustodyBusy(false); }
  }

  // Open counter mode seeded from a base offer (producer revises from a base scope/fee).
  function openCounter(baseScope?: string[], baseFee?: number | null) {
    if (baseScope) setConsents(new Set(baseScope));
    setCounterFee(baseFee == null ? "" : String(baseFee / 100));
    setCounterComment("");
    setCounterMode(true);
  }

  async function declineNego() {
    if (!negoBase) return;
    if (typeof window !== "undefined" && !window.confirm("End this negotiation without agreement?")) return;
    setNegoBusy(true); setSubmitError(null);
    try {
      const r = await fetch(`${negoBase}/negotiation/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: counterComment }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not decline."); return; }
      await refreshNego();
    } finally { setNegoBusy(false); }
  }

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
      const d = (await r.json()) as { ok?: boolean; error?: string; countered?: boolean };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not record your consent."); return; }
      if (d.countered) {
        // Scope differed from the request → sent to the production as a proposal.
        setAttested(false);
        await refreshNego();
      } else {
        setDone(true);
      }
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [acceptEndpoint, attested, consents, refreshNego]);

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

  // ── Withdrawn state ─────────────────────────────────────────────────────────
  if (withdrawn) {
    return (
      <Frame>
        <div className="rounded-xl p-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-lg font-medium mb-1" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>Consent withdrawn</h2>
          <p className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            Your consent for {vm.productionName} has been withdrawn. This stops new uses going forward; it does not undo lawful past uses. The production has been notified.
          </p>
        </div>
      </Frame>
    );
  }

  // ── Document state ──────────────────────────────────────────────────────────
  // The accepted ("done") state renders the full document read-only with a banner
  // + conversion/withdraw, so the performer always sees the full detail.
  const canAct = data.canAct;
  const isProducer = nego?.party === "producer";
  const canEditScope = (canAct && !done) || (isProducer && counterMode);

  // Done-state footer: a recorded banner, conversion (unregistered guests only),
  // and withdraw (registered performer/agent). No "register" pitch for registered users.
  const doneActions = (
    <>
      <div className="rounded-xl p-6 mb-4" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.04)" }}>
        <div className="flex items-start gap-3">
          <CheckCircle />
          <div>
            <h2 className="text-lg font-medium mb-1" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>Consent recorded</h2>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {firstName(vm.performerName)} consented to <strong style={{ color: "var(--color-text)" }}>{consentedList.length}</strong> of{" "}
              <strong style={{ color: "var(--color-text)" }}>{total}</strong> uses on {vm.productionName}. The production has been notified.
            </p>
          </div>
        </div>
      </div>
      {isGuest ? (
        custodyChoice === "rep_managed" ? (
          // Performer elected to leave the role production-held, managed by their rep.
          <div className="rounded-xl p-6" style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
            <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>You&apos;re done</p>
            <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>
              {vm.repName ? `${firstName(vm.repName)} will keep managing this for you.` : "Your agent will keep managing this for you."}
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
              {vm.companyName} holds your vault for {vm.productionName}, with the access you just consented to and nothing more.
              {vm.repName ? ` ${firstName(vm.repName)}` : " Your agent"} continues to manage requests on your behalf.
              You can register and take ownership yourself at any time — there&apos;s no rush.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className="rounded px-4 py-2 text-sm font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}>Set up my account anyway</Link>
            </div>
          </div>
        ) : vm.repName ? (
          // Two-way custody fork — take ownership now, or leave it with the agent.
          <div className="space-y-3">
            <div className="rounded-xl p-6" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.04)" }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Option 1 — take custody</p>
              <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>Set up your account and own your vault.</h2>
              <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                Register on ImageVault and take ownership — decide who else can access your data, withdraw consent instantly, and set standing
                instructions for every future request. Creating an account is free.
              </p>
              <button type="button" onClick={() => chooseCustody("self")} disabled={custodyBusy} className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>
                {custodyBusy ? "Working…" : "Set up my account & take custody"}
              </button>
            </div>
            <div className="rounded-xl p-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Option 2 — leave it with your agent</p>
              <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>You can leave it there.</h2>
              <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                {vm.companyName} holds your vault for {vm.productionName}, with the access you just consented to and nothing more, and
                {vm.repName ? ` ${firstName(vm.repName)}` : " your agent"} continues to manage it on your behalf. No account needed right now.
              </p>
              <button type="button" onClick={() => chooseCustody("rep_managed")} disabled={custodyBusy} className="rounded px-4 py-2 text-sm font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}>
                {custodyBusy ? "Working…" : `Leave it with ${vm.repName ? firstName(vm.repName) : "my agent"}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-6" style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
            <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>You&apos;re done</p>
            <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: "var(--font-display, inherit)" }}>Your consent is recorded. You can leave it there.</h2>
            <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
              Whenever you&apos;re ready, you can register on ImageVault and take ownership of your vault — decide who else can access your data,
              withdraw consent instantly, and set standing instructions for every future request. Creating an account is free; claiming the vault
              so you can relicense independently is a paid option.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>Set up my account</Link>
              <Link href="/imagevault-for-performers" className="rounded px-4 py-2 text-sm font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}>Tell me more first</Link>
            </div>
          </div>
        )
      ) : (
        data.canAct && consentedList.length > 0 && !isCast && (
          <div className="text-center">
            <button type="button" onClick={withdraw} disabled={negoBusy} className="text-xs" style={{ color: "var(--color-muted)", textDecoration: "underline" }}>
              {negoBusy ? "Withdrawing…" : "Withdraw consent"}
            </button>
          </div>
        )
      )}
    </>
  );
  // The performer's ticked set differs from what the production requested → confirming
  // becomes a proposal the production must agree to (licence mode only; guests have
  // no negotiation pre-account).
  const requestedScope = vm.requestedScope ?? [];
  const scopeChanged =
    (source.kind === "licence" || source.kind === "cast") &&
    requestedScope.length > 0 &&
    !(consents.size === requestedScope.length && requestedScope.every((r) => consents.has(r)));

  // The performer is proposing different terms when they've changed the ticked uses,
  // typed a fee, added a note, or explicitly opened the form. Reverting the uses to
  // what was requested with an empty fee and note drops straight back to plain confirm.
  // Suppressed once a proposal is already outstanding (unless they reopen the form to
  // revise) so the panel can show the "awaiting response" state instead.
  const proposing =
    proposeIntent ||
    (!nego?.pendingTalentCounter &&
      (scopeChanged || counterFee.trim() !== "" || counterComment.trim() !== ""));

  const cancelPropose = () => {
    setProposeIntent(false);
    setCounterFee("");
    setCounterComment("");
    setConsents(new Set(requestedScope));
  };

  // Counter form (shared by talent and producer). Scope comes from the toggles above.
  const counterForm = (onCancel: () => void = () => setCounterMode(false)) => (
    <div>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
        Adjust the use categories above, set your fee, and add a note. {isProducer ? "The performer will review and respond." : "The production will review and accept or counter."}
      </p>
      <label className="text-xs block mb-1" style={{ color: "var(--color-muted)" }}>Proposed fee (£) — leave blank for N/A</label>
      <input
        type="number" min={0} value={counterFee} onChange={(e) => setCounterFee(e.target.value)} placeholder="N/A"
        className="w-full mb-3 rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      />
      <textarea
        value={counterComment} onChange={(e) => setCounterComment(e.target.value)} placeholder="Add a note (optional)" rows={3}
        className="w-full mb-3 rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      />
      {submitError && <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: ACCENT, border: "1px solid rgba(192,57,43,0.2)" }}>{submitError}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={sendCounter} disabled={negoBusy} className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: negoBusy ? "var(--color-muted)" : ACCENT }}>
          {negoBusy ? "Sending…" : isProducer ? "Send counter" : "Send counter-offer"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm" style={{ color: "var(--color-muted)" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <Frame>
      {isPreview && (
        <div className="rounded-lg p-3.5 mb-5 flex items-start gap-2.5" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.05)" }}>
          <span style={{ color: ACCENT }}>◆</span>
          <p className="text-xs" style={{ color: "var(--color-text)", lineHeight: 1.55 }}>
            <strong>Preview.</strong> This is the consent document <strong>{firstName(vm.performerName)}</strong> will receive once you connect them — including the production detail and the uses being requested. Nothing has been sent yet. To send it, add your client&apos;s email on the reserved role and connect them.
          </p>
        </div>
      )}

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
                disabled={!canEditScope}
                onClick={() => canEditScope && toggle(c.id)}
                className="w-full flex items-start gap-3 rounded-lg p-3.5 text-left transition"
                style={{
                  border: `1px solid ${on ? ACCENT : "var(--color-border)"}`,
                  background: on ? "rgba(192,57,43,0.04)" : "var(--color-bg)",
                  cursor: canEditScope ? "pointer" : "default",
                  opacity: canEditScope ? 1 : 0.85,
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

      {/* Negotiation history */}
      {nego && nego.rounds.length > 0 && (
        <div className="rounded-xl p-5 mb-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Negotiation history</p>
          <div className="space-y-3">
            {nego.rounds.map((r) => <Round key={r.id} r={r} />)}
          </div>
        </div>
      )}

      {/* Actions — vary by party (or the recorded footer when consent is done) */}
      {isPreview ? (
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Preview only</p>
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            This document can&apos;t be confirmed here — only {firstName(vm.performerName)} (or you, acting on their behalf once connected) can give consent. Connect your client from your requests to send it.
          </p>
          <Link href="/vault/requests" className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>
            Back to requests
          </Link>
        </div>
      ) : done ? (
        doneActions
      ) : isProducer ? (
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>Negotiation</p>
          {nego?.closed ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {nego.rounds[nego.rounds.length - 1]?.action === "accepted"
                ? (isCast ? "Terms agreed — awaiting final consent from the performer." : "Terms agreed — consent is recorded.")
                : "This negotiation ended without agreement."}
            </p>
          ) : nego?.pendingTalentCounter ? (
            <>
              <p className="text-sm mb-2" style={{ color: "var(--color-text)" }}>
                <strong>{firstName(vm.performerName)}</strong> proposed different terms:
              </p>
              <OfferBox scope={nego.pendingTalentCounter.scope} fee={nego.pendingTalentCounter.fee} comment={nego.pendingTalentCounter.comment} />
              {counterMode ? counterForm() : (
                <>
                  {submitError && <ErrLine msg={submitError} />}
                  <button type="button" onClick={acceptCounter} disabled={negoBusy} className="w-full rounded px-4 py-2.5 text-sm font-medium text-white" style={{ background: negoBusy ? "var(--color-muted)" : ACCENT }}>
                    {negoBusy ? "Working…" : "Accept these terms"}
                  </button>
                  <div className="flex items-center justify-between mt-3">
                    <button type="button" onClick={() => openCounter(nego.pendingTalentCounter!.scope, nego.pendingTalentCounter!.fee)} className="text-xs font-medium" style={{ color: ACCENT }}>Counter back</button>
                    <button type="button" onClick={declineNego} className="text-xs" style={{ color: "var(--color-muted)" }}>Decline</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <p className="text-sm mb-2" style={{ color: "var(--color-muted)" }}>Waiting for {firstName(vm.performerName)} to respond to your current offer.</p>
              <OfferBox scope={nego?.currentOffer.scope ?? []} fee={nego?.currentOffer.fee ?? null} />
              {counterMode ? counterForm() : (
                <div className="flex items-center justify-between mt-1">
                  <button type="button" onClick={() => openCounter(nego?.currentOffer.scope ?? [], nego?.currentOffer.fee ?? null)} className="text-xs font-medium" style={{ color: ACCENT }}>Revise offer</button>
                  <button type="button" onClick={declineNego} className="text-xs" style={{ color: "var(--color-muted)" }}>Decline</button>
                </div>
              )}
            </>
          )}
        </div>
      ) : isCast && canAct ? (
        // Reserved rep managing a placeholder: pre-negotiate scope with the
        // production, then send the agreed document to the client for final consent.
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
          {sentTo ? (
            <>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Sent for consent</p>
              <p className="text-sm" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
                The consent document was emailed to <strong>{sentTo}</strong>. {firstName(vm.performerName)} will review the agreed terms and give final consent — they can take custody of their vault, or leave it with you to manage.
              </p>
            </>
          ) : nego?.closed && nego.rounds[nego.rounds.length - 1]?.action === "declined" ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>This negotiation ended without agreement.</p>
          ) : proposing ? (
            <>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Propose different terms to the production</p>
              {counterForm(cancelPropose)}
            </>
          ) : sendMode ? (
            <>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Send for final consent</p>
              <p className="text-sm mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>
                Email the agreed consent document to {firstName(vm.performerName)} for final sign-off. They decide whether to take custody of their vault or leave it with you to manage.
              </p>
              <label className="text-xs block mb-1" style={{ color: "var(--color-muted)" }}>Your client&apos;s email</label>
              <input
                type="email" value={sendEmailVal} onChange={(e) => setSendEmailVal(e.target.value)} placeholder="client@example.com"
                className="w-full mb-3 rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
              />
              {submitError && <ErrLine msg={submitError} />}
              <div className="flex items-center gap-2">
                <button type="button" onClick={sendForConsent} disabled={negoBusy} className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: negoBusy ? "var(--color-muted)" : ACCENT }}>
                  {negoBusy ? "Sending…" : "Send consent document"}
                </button>
                <button type="button" onClick={() => { setSendMode(false); setSubmitError(null); }} className="text-sm" style={{ color: "var(--color-muted)" }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Manage on behalf of {firstName(vm.performerName)}</p>
              {nego?.pendingTalentCounter ? (
                <div className="rounded-lg p-3 mb-4 text-xs" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.05)", color: "var(--color-text)" }}>
                  You&apos;ve proposed new terms — <strong>awaiting the production&apos;s response.</strong> You can still send for consent on the current terms, or revise your proposal.
                </div>
              ) : (
                <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>
                  Adjust the uses above to pre-negotiate the scope with the production, then send the document to your client for final consent.
                </p>
              )}
              <button type="button" onClick={() => { setSubmitError(null); setSendMode(true); }} className="w-full rounded px-4 py-2.5 text-sm font-medium text-white" style={{ background: ACCENT }}>
                Send for final consent
              </button>
              <div className="flex items-center justify-between mt-3">
                <button type="button" onClick={() => setProposeIntent(true)} className="text-xs font-medium" style={{ color: ACCENT }}>Propose different terms</button>
                {nego && nego.rounds.length > 0 && <button type="button" onClick={declineNego} className="text-xs" style={{ color: "var(--color-muted)" }}>Decline</button>}
              </div>
            </>
          )}
        </div>
      ) : canAct ? (
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
          {proposing ? (
            <>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Propose different terms</p>
              {counterForm(cancelPropose)}
            </>
          ) : (
            <>
              {nego?.pendingTalentCounter && (
                <div className="rounded-lg p-3 mb-4 text-xs" style={{ border: `1px solid ${ACCENT}`, background: "rgba(192,57,43,0.05)", color: "var(--color-text)" }}>
                  You&apos;ve proposed new terms — <strong>awaiting the production&apos;s response.</strong> You can revise your proposal, or confirm their current terms instead.
                </div>
              )}
              <button type="button" onClick={() => setAttested((a) => !a)} className="w-full flex items-start gap-3 text-left mb-4">
                <span className="mt-0.5 flex items-center justify-center rounded shrink-0" style={{ width: 18, height: 18, border: `1px solid ${attested ? ACCENT : "var(--color-border)"}`, background: attested ? ACCENT : "transparent", color: "white", fontSize: 12 }}>{attested ? "✓" : ""}</span>
                <span className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>{vm.copy.attestation}</span>
              </button>
              {submitError && <ErrLine msg={submitError} />}
              <button type="button" onClick={submit} disabled={!attested || submitting} className="w-full rounded px-4 py-2.5 text-sm font-medium text-white transition" style={{ background: !attested || submitting ? "var(--color-muted)" : ACCENT, cursor: !attested || submitting ? "not-allowed" : "pointer" }}>
                {submitting ? "Working…" : "Confirm consent"}
              </button>
              <div className="flex items-center justify-between mt-3">
                <button type="button" onClick={() => setProposeIntent(true)} className="text-xs font-medium" style={{ color: ACCENT }}>Propose different terms</button>
                {nego && nego.rounds.length > 0 && <button type="button" onClick={declineNego} className="text-xs" style={{ color: "var(--color-muted)" }}>Decline</button>}
              </div>
              <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-muted)" }}>Recorded with timestamp and document version. No signature required.</p>
            </>
          )}
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

function ErrLine({ msg }: { msg: string }) {
  return <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: "rgba(192,57,43,0.08)", color: ACCENT, border: "1px solid rgba(192,57,43,0.2)" }}>{msg}</p>;
}

function OfferBox({ scope, fee, comment }: { scope: string[]; fee: number | null; comment?: string | null }) {
  return (
    <div className="rounded-lg p-3 mb-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <p className="text-sm" style={{ color: "var(--color-text)" }}>{scopeNames(scope)}</p>
      <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>Fee: {feeLabel(fee)}</p>
      {comment && <p className="text-xs mt-1.5 italic" style={{ color: "var(--color-muted)" }}>&ldquo;{comment}&rdquo;</p>}
    </div>
  );
}

function Round({ r }: { r: NegotiationRound }) {
  const partyLabel = r.party === "producer" ? "Production" : r.party === "rep" ? "Agent" : "Performer";
  const actionLabel = r.action === "counter" ? "proposed" : r.action === "accepted" ? "accepted" : "declined";
  const date = new Date(r.createdAt * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>{partyLabel} {actionLabel}</span>
        <span className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>{date}</span>
      </div>
      {r.action === "counter" && (
        <>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>{scopeNames(r.scope)} · {feeLabel(r.fee)}</p>
          {r.comment && <p className="text-xs mt-1 italic" style={{ color: "var(--color-muted)" }}>&ldquo;{r.comment}&rdquo;</p>}
        </>
      )}
      {r.action === "declined" && r.comment && <p className="text-xs italic" style={{ color: "var(--color-muted)" }}>&ldquo;{r.comment}&rdquo;</p>}
    </div>
  );
}
