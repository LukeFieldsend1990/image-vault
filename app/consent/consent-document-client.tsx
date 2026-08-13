"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { USE_CATEGORIES, normaliseUseCategoryIds } from "@/lib/consent/use-categories";
import { buildRedline, summariseRedline, type RedlineEntry } from "@/lib/consent/redline";
import type { NegotiationRound } from "@/lib/consent/negotiation";
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

interface NegotiationState {
  party: "producer" | "talent" | "rep" | "admin" | null;
  currentOffer: { scope: string[]; fee: number | null };
  rounds: NegotiationRound[];
  pendingTalentCounter: NegotiationRound | null;
  closed: boolean;
}

function feeLabel(pence: number | null): string {
  if (pence == null) return "No fee (N/A)";
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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
// Brand tokens, replacing the pre-refresh `rgba(192,57,43,…)` literals this file
// used to hardcode. See docs/brand-refresh-spec.md.
const TINT = "var(--color-accent-tint)"; // brick tint — selected / attention
const OLIVE = "var(--color-active)"; // consent live
const OLIVE_TINT = "var(--color-active-tint)";
const OCHRE = "var(--color-expiring)"; // elevated-risk uses (§39E, §39G)
const OCHRE_TINT = "var(--color-expiring-tint)";
const SERIF = "var(--font-serif)";

/**
 * The two `sensitive` categories — digital replica (§39E) and generative-AI
 * training (§39G) — are the ones a performer is most likely to regret, and the
 * ones a union lawyer looks hardest at. They are separated out of the ordinary
 * list below and require a second, explicit confirmation before they can be
 * ticked. Un-ticking never needs confirmation: withdrawing should always be
 * easier than granting.
 */
const ORDINARY_CATEGORIES = USE_CATEGORIES.filter((c) => !c.sensitive);
const SENSITIVE_CATEGORIES = USE_CATEGORIES.filter((c) => c.sensitive);

export default function ConsentDocumentClient({ source }: { source: Source }) {
  const [data, setData] = useState<DocResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Set on a fresh acceptance so the performer can go straight to their receipt.
  // Absent when the page loads onto an already-accepted document — the accept
  // response is the only place the id is returned.
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);

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
  // Token mode: the unregistered performer ticked a different set than requested,
  // so confirming proposed different terms instead of finalising consent.
  const [guestProposed, setGuestProposed] = useState(false);

  // A sensitive use the performer has tapped but not yet confirmed. Only one can
  // be open at a time, so the confirmation is always unambiguous.
  const [pendingSensitive, setPendingSensitive] = useState<string | null>(null);

  // Preview mode: a reserved-role agent reads the document before connecting their
  // client. Read-only — no acceptance, no negotiation, no account exists yet.
  const isPreview = source.kind === "preview";
  const isCast = source.kind === "cast";
  const token = source.kind === "token" ? source.token : null;
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
  // The negative record. Rendered as prominently as the positive one — what a
  // performer refused is the half that matters in a dispute, and it has never
  // been shown anywhere in this product.
  const withheldList = useMemo(() => USE_CATEGORIES.filter((c) => !consents.has(c.id)), [consents]);

  /**
   * The thread as a redline.
   *
   * `currentOffer` is live state, not round zero — a producer counter overwrites
   * the licence's stored scope, so once one exists the opening ask is no longer
   * recoverable from it. So it is only safe to use as a baseline while no
   * producer counter has landed; after that the first round is shown as the
   * baseline and labelled as such, rather than diffing against a position that
   * has since been overwritten.
   */
  const redline = useMemo(() => {
    if (!nego) return [] as RedlineEntry[];
    const producerCountered = nego.rounds.some((r) => r.party === "producer" && r.action === "counter");
    return buildRedline({
      rounds: nego.rounds,
      baseline: producerCountered
        ? null
        : { scope: normaliseUseCategoryIds(nego.currentOffer.scope), fee: nego.currentOffer.fee },
    });
  }, [nego]);

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
      const d = (await r.json()) as { ok?: boolean; error?: string; countered?: boolean; acceptanceId?: string };
      if (!r.ok || !d.ok) { setSubmitError(d.error ?? "Could not record your consent."); return; }
      if (d.acceptanceId) setAcceptanceId(d.acceptanceId);
      if (d.countered) {
        // Scope differed from the request → sent to the production as a proposal.
        if (source.kind === "token") {
          setGuestProposed(true);
        } else {
          setAttested(false);
          await refreshNego();
        }
      } else {
        setDone(true);
      }
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [acceptEndpoint, attested, consents, refreshNego, source.kind]);

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

  // ── Proposed-different-terms state (unregistered performer) ─────────────────
  if (guestProposed) {
    return (
      <Frame>
        <div className="rounded-xl p-6" style={{ border: `1px solid ${ACCENT}`, background: TINT }}>
          <h2 className="text-lg font-medium mb-1" style={{ color: "var(--color-text)", fontFamily: SERIF }}>Your proposal has been sent</h2>
          <p className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            You changed the uses {vm.companyName} requested, so this is a proposal of different terms rather than consent. {vm.companyName}
            {vm.repName ? ` and your agent ${firstName(vm.repName)}` : ""} will review it and respond — consent isn&apos;t recorded until the terms match.
            You can reopen this link any time to see where things stand.
          </p>
        </div>
      </Frame>
    );
  }

  // ── Document state ──────────────────────────────────────────────────────────
  // The accepted ("done") state renders the full document read-only with a banner
  // + conversion, so the performer always sees the full detail.
  const canAct = data.canAct;
  const isProducer = nego?.party === "producer";
  const canEditScope = (canAct && !done) || (isProducer && counterMode);

  // Done-state footer: a recorded banner and conversion (unregistered guests only).
  // No "register" pitch for registered users. Withdrawal is deliberately not offered
  // here for now — it's a consequential, money-implicating step, not a simple click.
  const doneActions = (
    <>
      <div className="rounded-xl p-6 mb-4" style={{ border: `1px solid ${ACCENT}`, background: TINT }}>
        <div className="flex items-start gap-3">
          <CheckCircle />
          <div>
            <h2 className="text-lg font-medium mb-1" style={{ color: "var(--color-text)", fontFamily: SERIF }}>Consent recorded</h2>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {firstName(vm.performerName)} consented to <strong style={{ color: "var(--color-text)" }}>{consentedList.length}</strong> of{" "}
              <strong style={{ color: "var(--color-text)" }}>{total}</strong> uses on {vm.productionName}. The production has been notified.
            </p>

            {/* The performer's copy. Emailed either way; linked here when the
                acceptance was just made in this session. */}
            <div className="mt-3">
              {!isGuest && acceptanceId ? (
                <Link
                  href={`/consent/receipt/${acceptanceId}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium"
                  style={{ color: ACCENT }}
                >
                  View and print your consent receipt
                  <span aria-hidden>→</span>
                </Link>
              ) : (
                <p className="text-xs" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                  A receipt listing the uses consented to and the uses withheld has been emailed to
                  {vm.performerName ? ` ${firstName(vm.performerName)}` : " you"}.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {isGuest ? (
        custodyChoice === "rep_managed" ? (
          // Performer elected to leave the role production-held, managed by their rep.
          <div className="rounded-xl p-6" style={{ border: "2px solid var(--color-text)", background: "var(--color-bg)" }}>
            <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>You&apos;re done</p>
            <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: SERIF }}>
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
            <div className="rounded-xl p-6" style={{ border: `1px solid ${ACCENT}`, background: TINT }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Option 1 — take custody</p>
              <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: SERIF }}>Set up your account and own your vault.</h2>
              <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                Register on ImageVault and take ownership — decide who else can access your data and set standing
                instructions for every future request. Creating an account is free.
              </p>
              <button type="button" onClick={() => chooseCustody("self")} disabled={custodyBusy} className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>
                {custodyBusy ? "Working…" : "Set up my account & take custody"}
              </button>
            </div>
            <div className="rounded-xl p-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
              <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--color-muted)" }}>Option 2 — leave it with your agent</p>
              <h2 className="text-lg font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: SERIF }}>You can leave it there.</h2>
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
            <h2 className="text-xl font-medium mb-2" style={{ color: "var(--color-text)", fontFamily: SERIF }}>Your consent is recorded. You can leave it there.</h2>
            <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
              Whenever you&apos;re ready, you can register on ImageVault and take ownership of your vault — decide who else can access your data
              and set standing instructions for every future request. Creating an account is free; claiming the vault
              so you can relicense independently is a paid option.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/signup" className="rounded px-4 py-2 text-sm font-medium text-white" style={{ background: ACCENT }}>Set up my account</Link>
              <Link href="/imagevault-for-performers" className="rounded px-4 py-2 text-sm font-medium" style={{ border: "1px solid var(--color-border)", color: "var(--color-text)" }}>Tell me more first</Link>
            </div>
          </div>
        )
      ) : null}
    </>
  );
  // The performer's ticked set differs from what the production requested → confirming
  // becomes a proposal the production must agree to (licence mode only; guests have
  // no negotiation pre-account).
  const requestedScope = vm.requestedScope ?? [];
  // The latest suggested position on the table: the performer's own outstanding
  // counter if one is open, otherwise the production's current offer (kept live by
  // refreshNego — a producer counter revises the licence row, so the load-time
  // requestedScope can be stale mid-session), otherwise the requested scope.
  const latestPosition: string[] =
    nego?.pendingTalentCounter?.scope ?? nego?.currentOffer.scope ?? requestedScope;
  // No length guard on the baseline: a production can send an empty ask (no uses
  // stored on the role or its default terms), and ticking any use against that is
  // still a change — the guard used to swallow it, leaving the confirm button up.
  const scopeChanged =
    (source.kind === "licence" || source.kind === "cast" || source.kind === "token") &&
    !(consents.size === latestPosition.length && latestPosition.every((r) => consents.has(r)));

  // Ticking straight back to the production's standing offer is an acceptance of
  // their terms, not a new proposal — keep the confirm button for that case (it's
  // the "confirm their current terms instead" path while a counter is outstanding).
  const matchesCurrentOffer =
    !!nego &&
    consents.size === nego.currentOffer.scope.length &&
    nego.currentOffer.scope.every((r) => consents.has(r));

  // The performer is proposing different terms when they've ticked any use away
  // from the latest suggested position, typed a fee, added a note, or explicitly
  // opened the form — the propose panel then replaces the final consent button.
  // Reverting the uses with an empty fee and note drops straight back to plain
  // confirm (or, with a counter outstanding, the "awaiting response" state).
  const proposing =
    proposeIntent ||
    counterFee.trim() !== "" ||
    counterComment.trim() !== "" ||
    (scopeChanged && !matchesCurrentOffer);

  const cancelPropose = () => {
    setProposeIntent(false);
    setCounterFee("");
    setCounterComment("");
    setConsents(new Set(latestPosition));
  };

  // Counter form (shared by talent and producer). Scope comes from the toggles above.
  const counterForm = (onCancel: () => void = () => setCounterMode(false)) => (
    <div>
      <p className="text-xs mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
        Adjust the use categories above, set your fee, and add a note. {isProducer ? "The performer will review and respond." : "The production will review and accept or counter."}
      </p>
      <label className="text-xs block mb-1" style={{ color: "var(--color-muted)" }}>Proposed fee ($) — leave blank for N/A</label>
      <input
        type="number" min={0} value={counterFee} onChange={(e) => setCounterFee(e.target.value)} placeholder="N/A"
        className="w-full mb-3 rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      />
      <textarea
        value={counterComment} onChange={(e) => setCounterComment(e.target.value)} placeholder="Add a note (optional)" rows={3}
        className="w-full mb-3 rounded px-3 py-2 text-sm" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
      />
      {submitError && <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: TINT, color: ACCENT, border: `1px solid ${ACCENT}` }}>{submitError}</p>}
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
        <div className="rounded-lg p-3.5 mb-5 flex items-start gap-2.5" style={{ border: `1px solid ${ACCENT}`, background: TINT }}>
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

      <header className="mb-9">
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-3" style={{ color: ACCENT }}>{vm.copy.kicker}</p>
        <h1
          className="mb-4"
          style={{
            fontFamily: SERIF,
            fontSize: "clamp(28px, 5vw, 38px)",
            fontWeight: 600,
            letterSpacing: "-0.018em",
            lineHeight: 1.12,
            color: "var(--color-ink)",
          }}
        >
          {vm.copy.title}
        </h1>
        <p className="text-[15px] mb-6" style={{ color: "var(--color-text)", lineHeight: 1.7, maxWidth: "58ch" }}>{vm.copy.lead}</p>
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
        <SectionHead num={vm.copy.consentSection.num} heading={vm.copy.consentSection.heading} />
        <p className="text-sm mb-5" style={{ color: "var(--color-muted)", lineHeight: 1.65 }}>{vm.copy.consentSection.intro}</p>

        <div className="space-y-2.5">
          {ORDINARY_CATEGORIES.map((c) => (
            <UseCard
              key={c.id}
              category={c}
              on={consents.has(c.id)}
              requested={vm.requestedScope.includes(c.id)}
              editable={canEditScope}
              onToggle={() => toggle(c.id)}
            />
          ))}
        </div>

        {/* Elevated-risk uses. Framed apart, and gated behind a second tap — the
            friction is the point, and it should be visible that it exists. */}
        <div
          className="mt-6 pl-4"
          style={{ borderLeft: `3px solid ${OCHRE}` }}
        >
          <p
            className="text-[11px] font-semibold tracking-widest uppercase mb-1.5"
            style={{ color: OCHRE }}
          >
            These two go further
          </p>
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
            The uses below let your likeness perform things you never filmed, or
            teach a model to generate new performances. They are the two people
            most often wish they had thought harder about. Each needs a separate
            confirmation, and you can withdraw either at any time.
          </p>
          <div className="space-y-2.5">
            {SENSITIVE_CATEGORIES.map((c) => (
              <UseCard
                key={c.id}
                category={c}
                on={consents.has(c.id)}
                requested={vm.requestedScope.includes(c.id)}
                editable={canEditScope}
                pendingConfirm={pendingSensitive === c.id}
                onToggle={() => {
                  if (consents.has(c.id)) {
                    // Withdrawing is never gated.
                    toggle(c.id);
                    setPendingSensitive(null);
                    return;
                  }
                  setPendingSensitive((p) => (p === c.id ? null : c.id));
                }}
                onConfirm={() => {
                  toggle(c.id);
                  setPendingSensitive(null);
                }}
                onCancelConfirm={() => setPendingSensitive(null)}
              />
            ))}
          </div>
        </div>
      </section>

      {vm.copy.after.map((s) => <DocSection key={s.num} s={s} />)}

      {/* Dynamic summary — both halves of the decision, weighted equally. */}
      <div className="rounded-xl p-5 mb-6" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>In summary</p>
        <p className="text-sm mb-4" style={{ color: "var(--color-ink)", lineHeight: 1.6 }}>
          {done ? "You consented to" : "You are about to consent to"}{" "}
          <strong>{consentedList.length}</strong> of <strong>{total}</strong> uses on {vm.productionName}.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase mb-1.5" style={{ color: OLIVE }}>
              Consenting to
            </p>
            {consentedList.length > 0 ? (
              <ul className="space-y-1">
                {consentedList.map((c) => (
                  <li key={c.id} className="text-sm flex gap-2" style={{ color: "var(--color-ink)" }}>
                    <span style={{ color: OLIVE }}>✓</span>
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic" style={{ color: "var(--color-muted)" }}>
                Nothing. Confirming with nothing ticked refuses consent entirely — which is a valid answer.
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase mb-1.5" style={{ color: "var(--color-muted)" }}>
              Withholding
            </p>
            {withheldList.length > 0 ? (
              <ul className="space-y-1">
                {withheldList.map((c) => (
                  <li key={c.id} className="text-sm flex gap-2" style={{ color: "var(--color-muted)" }}>
                    <span>—</span>
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm italic" style={{ color: "var(--color-muted)" }}>
                Nothing — you are consenting to every use on this document.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Negotiation history, as a redline against the position before it */}
      {nego && nego.rounds.length > 0 && (
        <div className="rounded-xl p-5 mb-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-xs font-medium tracking-widest uppercase mb-1" style={{ color: "var(--color-muted)" }}>Negotiation history</p>
          <p className="text-xs mb-3" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>
            Each round shows what moved from the position before it.
          </p>
          <div className="space-y-3">
            {redline.map((entry) => <Round key={entry.round.id} entry={entry} />)}
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
                <div className="rounded-lg p-3 mb-4 text-xs" style={{ border: `1px solid ${ACCENT}`, background: TINT, color: "var(--color-text)" }}>
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
      ) : isGuest && canAct ? (
        // Unregistered performer: changing the requested uses turns "Confirm" into
        // "Propose different terms" (same rule as the registered surface). The
        // accept endpoint records it as a counter on the cast negotiation thread.
        <div className="rounded-xl p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
          {scopeChanged && (
            <div className="rounded-lg p-3 mb-4 text-xs" style={{ border: `1px solid ${ACCENT}`, background: TINT, color: "var(--color-text)" }}>
              You&apos;ve changed the uses {vm.companyName} requested. Confirming now <strong>proposes these different terms</strong> — {vm.companyName}
              {vm.repName ? ` and your agent ${firstName(vm.repName)}` : ""} must agree before consent is recorded.{" "}
              <button type="button" onClick={() => setConsents(new Set(requestedScope))} className="font-medium underline" style={{ color: ACCENT }}>Reset to requested</button>
            </div>
          )}
          <button type="button" onClick={() => setAttested((a) => !a)} className="w-full flex items-start gap-3 text-left mb-4">
            <span className="mt-0.5 flex items-center justify-center rounded shrink-0" style={{ width: 18, height: 18, border: `1px solid ${attested ? ACCENT : "var(--color-border)"}`, background: attested ? ACCENT : "transparent", color: "white", fontSize: 12 }}>{attested ? "✓" : ""}</span>
            <span className="text-sm" style={{ color: "var(--color-muted)", lineHeight: 1.55 }}>{vm.copy.attestation}</span>
          </button>
          {submitError && <ErrLine msg={submitError} />}
          <button type="button" onClick={submit} disabled={!attested || submitting} className="w-full rounded px-4 py-2.5 text-sm font-medium text-white transition" style={{ background: !attested || submitting ? "var(--color-muted)" : ACCENT, cursor: !attested || submitting ? "not-allowed" : "pointer" }}>
            {submitting ? "Working…" : scopeChanged ? "Propose different terms" : "Confirm consent"}
          </button>
          <p className="text-[11px] text-center mt-2" style={{ color: "var(--color-muted)" }}>Recorded with timestamp and document version. No signature required.</p>
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
                <div className="rounded-lg p-3 mb-4 text-xs" style={{ border: `1px solid ${ACCENT}`, background: TINT, color: "var(--color-text)" }}>
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

      {/* Live decision rail — only while the performer is still deciding. */}
      {canEditScope && <DecisionRail granted={consentedList} withheld={withheldList} />}
    </Frame>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      {/* Bottom padding clears the fixed decision rail. */}
      <div className="mx-auto px-5 pt-12 pb-32" style={{ maxWidth: 720 }}>{children}</div>
    </div>
  );
}

/**
 * A numbered heading with the numeral hanging in a mono gutter, so the document
 * reads as a numbered instrument rather than a web form.
 */
function SectionHead({ num, heading }: { num: string; heading: string }) {
  return (
    <div className="flex gap-4 mb-3">
      <span
        className="shrink-0 pt-1.5 text-right"
        style={{ width: 22, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-faint)" }}
      >
        {num}
      </span>
      <h2
        className="min-w-0"
        style={{
          fontFamily: SERIF,
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          lineHeight: 1.25,
          color: "var(--color-ink)",
          margin: 0,
        }}
      >
        {heading}
      </h2>
    </div>
  );
}

function DocSection({ s }: { s: { num: string; heading: string; paragraphs: string[]; emphasis?: string } }) {
  return (
    <section className="mb-7">
      <SectionHead num={s.num} heading={s.heading} />
      {s.paragraphs.map((p, i) => (
        <p key={i} className="text-sm mb-2.5" style={{ color: "var(--color-text)", lineHeight: 1.7 }}>{p}</p>
      ))}
      {s.emphasis && (
        <div
          className="rounded-lg p-4 mt-3 text-sm"
          style={{
            background: "var(--color-surface)",
            borderLeft: `3px solid ${ACCENT}`,
            color: "var(--color-ink)",
            lineHeight: 1.65,
          }}
        >
          {s.emphasis}
        </div>
      )}
    </section>
  );
}

/**
 * One use category. Ordinary uses toggle on a single tap; sensitive ones open an
 * inline confirmation instead, and only commit when it is accepted.
 */
function UseCard({
  category: c,
  on,
  requested,
  editable,
  pendingConfirm,
  onToggle,
  onConfirm,
  onCancelConfirm,
}: {
  category: (typeof USE_CATEGORIES)[number];
  on: boolean;
  requested: boolean;
  editable: boolean;
  pendingConfirm?: boolean;
  onToggle: () => void;
  onConfirm?: () => void;
  onCancelConfirm?: () => void;
}) {
  const edge = on ? OLIVE : pendingConfirm ? OCHRE : "var(--color-border)";
  const fill = on ? OLIVE_TINT : pendingConfirm ? OCHRE_TINT : "var(--color-bg)";

  return (
    <div
      className="rounded-lg overflow-hidden transition"
      style={{ border: `1px solid ${edge}`, background: fill, opacity: editable ? 1 : 0.85 }}
    >
      <button
        type="button"
        disabled={!editable}
        onClick={() => editable && onToggle()}
        aria-pressed={on}
        className="w-full flex items-start gap-3 p-3.5 text-left"
        style={{ cursor: editable ? "pointer" : "default" }}
      >
        <span
          className="mt-0.5 flex items-center justify-center rounded shrink-0"
          style={{
            width: 18,
            height: 18,
            border: `1px solid ${on ? OLIVE : "var(--color-border)"}`,
            background: on ? OLIVE : "transparent",
            color: "white",
            fontSize: 12,
          }}
        >
          {on ? "✓" : ""}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{c.name}</span>
            {c.regimeTag && <Pill bg="var(--color-surface)" color="var(--color-muted)" border>{c.regimeTag}</Pill>}
            {c.sensitive && <Pill bg={OCHRE_TINT} color={OCHRE}>needs extra care</Pill>}
            {requested && <Pill bg={TINT} color={ACCENT}>requested</Pill>}
          </span>
          <span className="block text-sm mt-1" style={{ color: "var(--color-text)", lineHeight: 1.55 }}>{c.description}</span>
          <span className="block text-xs mt-1.5 italic" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>{c.example}</span>
        </span>
      </button>

      {pendingConfirm && (
        <div className="px-3.5 pb-3.5 pt-0.5" style={{ borderTop: `1px solid ${OCHRE}` }}>
          <p className="text-xs mt-3 mb-3" style={{ color: "var(--color-ink)", lineHeight: 1.6 }}>
            Consenting to <strong>{c.name.toLowerCase()}</strong> {c.regimeTag ? `(${c.regimeTag}) ` : ""}
            means {c.example.charAt(0).toLowerCase()}{c.example.slice(1).replace(/\.$/, "")}. Confirm only if
            you are comfortable with that.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="rounded px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: OCHRE }}
            >
              Yes — I consent to this
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              className="text-xs"
              style={{ color: "var(--color-muted)" }}
            >
              Not this one
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The decision rail. Pinned to the bottom of the viewport so both halves of the
 * decision — what is being granted and what is being refused — stay in front of
 * the performer while they read, rather than only appearing in a summary they
 * may scroll past.
 */
function DecisionRail({
  granted,
  withheld,
}: {
  granted: { id: string; name: string }[];
  withheld: { id: string; name: string }[];
}) {
  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-40"
      style={{
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
        boxShadow: "0 -6px 18px rgba(45,43,38,0.06)",
      }}
    >
      <div className="mx-auto px-5 py-3" style={{ maxWidth: 720 }}>
        <div className="flex items-start gap-5 flex-wrap">
          <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
            <p
              className="text-[10px] font-semibold tracking-widest uppercase mb-1 flex items-center gap-1.5"
              style={{ color: OLIVE }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: OLIVE, display: "inline-block" }} />
              Consenting to {granted.length}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--color-text)" }}>
              {granted.length ? granted.map((c) => c.name).join(", ") : "Nothing yet"}
            </p>
          </div>
          <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
            <p
              className="text-[10px] font-semibold tracking-widest uppercase mb-1 flex items-center gap-1.5"
              style={{ color: "var(--color-muted)" }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  border: "1.5px solid var(--color-muted)",
                  display: "inline-block",
                  boxSizing: "border-box",
                }}
              />
              Withholding {withheld.length}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
              {withheld.length ? withheld.map((c) => c.name).join(", ") : "Nothing — you are consenting to all uses"}
            </p>
          </div>
        </div>
      </div>
    </div>
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
  return <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: TINT, color: ACCENT, border: `1px solid ${ACCENT}` }}>{msg}</p>;
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

/** Name a use category for the redline, falling back to the raw id. */
function categoryName(id: string): string {
  return USE_CATEGORIES.find((c) => c.id === id)?.name ?? id;
}

/**
 * One round, shown as what moved rather than as a standalone position.
 *
 * Additions read in olive (a right granted), removals in brick with a
 * strikethrough (a right withdrawn) — the same grammar the consent picker and
 * the printed documents use, so the colours mean one thing across the product.
 */
function Round({ entry }: { entry: RedlineEntry }) {
  const r = entry.round;
  const partyLabel = r.party === "producer" ? "Production" : r.party === "rep" ? "Agent" : "Performer";
  const actionLabel = r.action === "counter" ? "proposed" : r.action === "accepted" ? "accepted" : "declined";
  const date = new Date(r.createdAt * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
      <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
        <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-faint)", marginRight: 6 }}>
            {String(r.round).padStart(2, "0")}
          </span>
          {partyLabel} {actionLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] font-medium" style={{ color: "var(--color-muted)" }}>{summariseRedline(entry)}</span>
          <span className="text-[10px] font-mono" style={{ color: "var(--color-muted)" }}>{date}</span>
        </span>
      </div>

      {/* A decline states no scope — its empty scope means "none given", not
          "every use withdrawn", so no diff is drawn for it. */}
      {!entry.scopeStated ? (
        r.comment ? (
          <p className="text-xs italic" style={{ color: "var(--color-muted)" }}>&ldquo;{r.comment}&rdquo;</p>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>No terms stated.</p>
        )
      ) : (
        <>
          {entry.isBaseline && (
            <p className="text-[11px] mb-1.5" style={{ color: "var(--color-muted)" }}>
              First position on record — nothing earlier to compare against.
            </p>
          )}

          {(entry.added.length > 0 || entry.removed.length > 0) && (
            <div className="flex flex-col gap-1 mb-1.5">
              {entry.added.map((id) => (
                <span key={`a-${id}`} className="text-xs flex items-start gap-1.5" style={{ color: OLIVE }}>
                  <span aria-hidden>+</span>
                  <span style={{ color: "var(--color-ink)" }}>{categoryName(id)}</span>
                </span>
              ))}
              {entry.removed.map((id) => (
                <span key={`r-${id}`} className="text-xs flex items-start gap-1.5" style={{ color: ACCENT }}>
                  <span aria-hidden>−</span>
                  <span style={{ color: "var(--color-muted)", textDecoration: "line-through" }}>{categoryName(id)}</span>
                </span>
              ))}
            </div>
          )}

          {/* The full resulting position, so a reader never has to reassemble it
              from the deltas above. */}
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {entry.isBaseline ? "" : "Now: "}{scopeNames(r.scope)}
          </p>

          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {r.fee === null ? (
              // null is ambiguous on write between "unchanged" and "cleared to
              // N/A", so it is reported as unstated rather than as a fee of zero.
              <>No fee stated</>
            ) : entry.feeChanged ? (
              <>
                Fee <span style={{ textDecoration: "line-through" }}>{feeLabel(entry.feeFrom)}</span>{" "}
                <span aria-hidden>→</span>{" "}
                <span style={{ color: "var(--color-ink)", fontWeight: 500 }}>{feeLabel(entry.feeTo)}</span>
              </>
            ) : (
              <>Fee {feeLabel(r.fee)}</>
            )}
          </p>

          {r.comment && (
            <p className="text-xs mt-1 italic" style={{ color: "var(--color-muted)" }}>&ldquo;{r.comment}&rdquo;</p>
          )}
        </>
      )}
    </div>
  );
}
