"use client";

/**
 * The public scan-value calculator.
 *
 * Everything here runs in the browser on state the visitor types. The only
 * network calls are two anonymous GETs that proxy TMDB for names and credits —
 * no fees, no scan markings and no totals are ever sent to us or stored. That
 * promise is the reason a working actor will try this, so it is stated on the
 * page too.
 *
 * Sharing works within that constraint rather than around it: a filled-in sheet
 * is packed into the link itself (lib/calculator/share.ts) so an agent can hand
 * the performer a QR code and have them land on the finished number. The link
 * therefore carries the fees that were typed, and the share panel says so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import Wordmark from "@/app/components/wordmark";
import {
  calculate,
  DEFAULT_ASSUMPTIONS,
  type CalculatorAssumptions,
  type CreditInput,
} from "@/lib/calculator/model";
import {
  CURRENCIES,
  currencySymbol,
  formatMoney,
  type CurrencyCode,
} from "@/lib/calculator/currency";
import {
  SHARE_PARAM,
  buildShareUrl,
  decodeShareState,
  type ShareState,
} from "@/lib/calculator/share";
import type { CalculatorCredit, CalculatorPerson } from "@/lib/calculator/tmdb";

interface RowState {
  fee: string;
  scanned: boolean;
  reshoots: boolean;
}

const EMPTY_ROW: RowState = { fee: "", scanned: false, reshoots: false };

const money = formatMoney;

function toNumber(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One person's credit sheet. Throws with the API's own message on failure. */
async function fetchSheet(
  personId: number,
  years: number,
): Promise<{ person: CalculatorPerson; credits: CalculatorCredit[] }> {
  const res = await fetch(`/api/calculator/credits?personId=${personId}&years=${years}`);
  const data = (await res.json()) as {
    person?: CalculatorPerson;
    credits?: CalculatorCredit[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Couldn't load credits");
  return {
    person: data.person ?? { id: personId, name: "", profileImageUrl: null, knownFor: [] },
    credits: data.credits ?? [],
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The re-licensing caption.
 *
 * A qualifying scan with a blank fee earns nothing, so a non-zero count sitting
 * beside £0 reads as a broken calculator. Say which rows are still missing a fee
 * instead of leaving the reader to work it out.
 */
function relicenceNote(relicensable: number, withoutFee: number, cycles: number): string {
  const base =
    relicensable === 0
      ? "no scans could have used an earlier one"
      : `${plural(relicensable, "re-licence", "re-licences")} across ${plural(cycles, "scan cycle", "scan cycles")}`;
  if (relicensable === 0 || withoutFee === 0) return base;
  if (withoutFee === relicensable) {
    return `${base} — none have a fee yet`;
  }
  return `${base} — ${withoutFee} still ${withoutFee === 1 ? "needs" : "need"} a fee`;
}

/** "3 years" / "2.4 years" — whole numbers stay whole. */
function formatYears(years: number): string {
  const rounded = Math.round(years * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} ${rounded === 1 ? "year" : "years"}`;
}

/* ─────────────────────────── small presentational bits ─────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-medium tracking-widest uppercase"
      style={{ color: "var(--color-muted)" }}
    >
      {children}
    </p>
  );
}

function StepHeading({ step, title, hint }: { step: string; title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <Eyebrow>Step {step}</Eyebrow>
      <h2
        className="mt-1 text-lg font-medium"
        style={{ color: "var(--color-ink)", fontFamily: "var(--font-serif)" }}
      >
        {title}
      </h2>
      {hint && (
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="px-2.5 py-1 text-xs font-medium tracking-wide uppercase transition"
      style={{
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
        background: active ? "var(--color-accent-tint)" : "var(--color-inset)",
        color: active ? "var(--color-accent)" : "var(--color-muted)",
      }}
    >
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  background: "var(--color-inset)",
  color: "var(--color-ink)",
  borderRadius: "var(--radius-md)",
};

/* ────────────────────────────────── page ───────────────────────────────────── */

export default function CalculatorClient() {
  const searchParams = useSearchParams();

  // Identity
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<CalculatorPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState<CalculatorPerson | null>(null);

  // Credits
  const [credits, setCredits] = useState<CalculatorCredit[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [error, setError] = useState("");

  // Inputs
  const [currency, setCurrency] = useState<CurrencyCode>("GBP");
  const [bulkFee, setBulkFee] = useState("");
  const [adsPerYear, setAdsPerYear] = useState("");
  const [adFee, setAdFee] = useState("");

  // Assumptions
  const [assumptions, setAssumptions] = useState<CalculatorAssumptions>(DEFAULT_ASSUMPTIONS);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Share
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [origin, setOrigin] = useState("");

  // True when this sheet arrived pre-filled from someone else's share link.
  const [fromSharedLink, setFromSharedLink] = useState(false);

  const symbol = currencySymbol(currency);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  /* ── search ── */

  useEffect(() => {
    const q = query.trim();
    if (person || q.length < 2) {
      setPeople([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/calculator/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { people?: CalculatorPerson[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Search failed");
        setPeople(data.people ?? []);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Search failed");
        }
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, person]);

  const pickPerson = useCallback(
    async (picked: CalculatorPerson) => {
      setPerson(picked);
      setPeople([]);
      setQuery(picked.name);
      setError("");
      setFromSharedLink(false);
      setLoadingCredits(true);
      try {
        const { credits: loaded } = await fetchSheet(picked.id, DEFAULT_ASSUMPTIONS.lookbackYears);
        setCredits(loaded);
        setRows(Object.fromEntries(loaded.map((c) => [c.id, { ...EMPTY_ROW }])));
        setDropped(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load credits");
        setCredits([]);
      } finally {
        setLoadingCredits(false);
      }
    },
    [],
  );

  /* ── restore a shared sheet ──
   *
   * Credits are re-fetched rather than carried in the link: only the markings
   * need to travel. Anything the sharer marked that TMDB no longer returns is
   * dropped, and anything new since they shared arrives blank — the recipient
   * sees a live sheet with the sharer's work on it, not a frozen snapshot. */

  const shared = useMemo(
    () => decodeShareState(searchParams.get(SHARE_PARAM)),
    [searchParams],
  );

  useEffect(() => {
    if (!shared) return;
    let cancelled = false;

    void (async () => {
      setLoadingCredits(true);
      setFromSharedLink(true);
      setCurrency(shared.currency);
      setAssumptions(shared.assumptions);
      setAdsPerYear(shared.advertising.engagementsPerYear ? String(shared.advertising.engagementsPerYear) : "");
      setAdFee(shared.advertising.averageFee ? String(shared.advertising.averageFee) : "");

      try {
        const { person: loadedPerson, credits: loaded } = await fetchSheet(
          shared.personId,
          shared.assumptions.lookbackYears,
        );
        if (cancelled) return;

        const marks = new Map(shared.credits.map((c) => [c.id, c]));
        setPerson(loadedPerson);
        setQuery(loadedPerson.name);
        setCredits(loaded);
        setRows(
          Object.fromEntries(
            loaded.map((credit) => {
              const mark = marks.get(credit.id);
              return [
                credit.id,
                mark
                  ? { fee: mark.fee > 0 ? String(mark.fee) : "", scanned: mark.scanned, reshoots: mark.reshoots }
                  : { ...EMPTY_ROW },
              ];
            }),
          ),
        );
        setDropped(new Set(shared.credits.filter((c) => c.dropped).map((c) => c.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open that shared link");
      } finally {
        if (!cancelled) setLoadingCredits(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shared]);

  function startOver() {
    setPerson(null);
    setQuery("");
    setPeople([]);
    setShareOpen(false);
    setFromSharedLink(false);
    setCredits([]);
    setRows({});
    setDropped(new Set());
    setError("");
  }

  /* ── row editing ── */

  const activeCredits = useMemo(
    () => credits.filter((c) => !dropped.has(c.id)),
    [credits, dropped],
  );

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), ...patch } }));
  }

  function applyBulkFee(onlyEmpty: boolean) {
    const value = bulkFee.trim();
    if (!value) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const credit of activeCredits) {
        const row = next[credit.id] ?? { ...EMPTY_ROW };
        if (onlyEmpty && row.fee.trim()) continue;
        next[credit.id] = { ...row, fee: value };
      }
      return next;
    });
  }

  function setAllScanned(scanned: boolean) {
    setRows((prev) => {
      const next = { ...prev };
      for (const credit of activeCredits) {
        next[credit.id] = { ...(next[credit.id] ?? EMPTY_ROW), scanned };
      }
      return next;
    });
  }

  function dropCredit(id: string) {
    setDropped((prev) => new Set(prev).add(id));
  }

  /* ── the maths ── */

  const inputs: CreditInput[] = useMemo(
    () =>
      activeCredits.map((credit) => {
        const row = rows[credit.id] ?? EMPTY_ROW;
        return {
          id: credit.id,
          releaseDate: credit.releaseDate,
          scanned: row.scanned,
          reshoots: row.reshoots,
          fee: toNumber(row.fee),
        };
      }),
    [activeCredits, rows],
  );

  const result = useMemo(
    () =>
      calculate(
        inputs,
        { engagementsPerYear: toNumber(adsPerYear), averageFee: toNumber(adFee) },
        assumptions,
      ),
    [inputs, adsPerYear, adFee, assumptions],
  );

  const outcomeById = useMemo(
    () => new Map(result.credits.map((c) => [c.id, c])),
    [result],
  );

  /* ── sharing ──
   *
   * The whole sheet rides in the link, so an agent can fill it in and hand the
   * performer a QR code that opens on the finished number. */

  const shareState: ShareState | null = useMemo(() => {
    if (!person) return null;
    return {
      personId: person.id,
      currency,
      advertising: { engagementsPerYear: toNumber(adsPerYear), averageFee: toNumber(adFee) },
      assumptions,
      credits: credits.map((credit) => {
        const row = rows[credit.id] ?? EMPTY_ROW;
        return {
          id: credit.id,
          fee: toNumber(row.fee),
          scanned: row.scanned,
          reshoots: row.reshoots,
          dropped: dropped.has(credit.id),
        };
      }),
    };
  }, [person, currency, adsPerYear, adFee, assumptions, credits, rows, dropped]);

  // Empty until the origin lands after mount, which keeps the server render and
  // the first client render identical.
  const shareUrl = useMemo(
    () => (origin && shareState ? buildShareUrl(origin, shareState) : ""),
    [origin, shareState],
  );

  const shareMessage = useMemo(
    () =>
      `I worked out what ${person?.name ? "your" : "my"} scans would have been worth over the last ` +
      `${assumptions.lookbackYears} years: ${money(result.total, currency)}. ` +
      `Here are the figures — you can change any of them: ${shareUrl}`,
    [person, assumptions.lookbackYears, result.total, currency, shareUrl],
  );

  function flashCopied(what: "link" | "message") {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500);
  }

  async function copyToClipboard(text: string, what: "link" | "message") {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(what);
    } catch {
      /* clipboard blocked — the link is on screen and selectable anyway */
    }
  }

  async function shareNatively() {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "What is your scan worth?", text: shareMessage, url: shareUrl });
        return;
      }
      await copyToClipboard(shareMessage, "message");
    } catch {
      /* visitor dismissed the share sheet — nothing to recover from */
    }
  }

  const signupHref = `/register-interest?from=calculator&est=${Math.round(result.total)}&currency=${currency}${
    person ? `&name=${encodeURIComponent(person.name)}` : ""
  }`;

  /* ────────────────────────────── render ────────────────────────────── */

  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      {/* ── chrome ── */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          borderColor: "var(--color-border)",
          background: "rgba(255,255,255,0.93)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3.5">
          <Link href="/product" aria-label="ImageVault">
            <Wordmark variant="display" tone="ink" style={{ fontSize: "1.05rem" }} />
          </Link>
          <Link
            href="/login"
            className="text-xs font-medium tracking-wide uppercase transition hover:opacity-60"
            style={{ color: "var(--color-muted)" }}
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 pb-16 pt-12">
        {/* ── hero ── */}
        <section className="mb-12">
          <Eyebrow>The scan value calculator</Eyebrow>
          <h1
            className="mt-3 text-4xl font-medium md:text-5xl"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-serif)", lineHeight: 1.1 }}
          >
            What is your scan actually worth?
          </h1>
          <p className="mt-4 max-w-2xl text-base" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
            A scan stays usable for years after the shoot wraps. The next production that scanned you
            could have licensed it instead of paying to make its own. Mark your last{" "}
            {assumptions.lookbackYears} years of credits and see what that was worth.
          </p>
          <p
            className="mt-4 inline-block px-3 py-1.5 text-xs"
            style={{
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            Nothing you type is sent to us or stored. Close the tab and it&apos;s gone.
          </p>
        </section>

        {error && (
          <div
            className="mb-8 px-4 py-3 text-sm"
            style={{
              border: "1px solid var(--color-accent)",
              background: "var(--color-accent-tint)",
              color: "var(--color-accent)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {error}
          </div>
        )}

        {fromSharedLink && (
          <div
            className="mb-8 px-4 py-3"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>
              Someone filled this in for you.
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
              The figures below came from the link you opened. Change anything that looks wrong.
            </p>
          </div>
        )}

        {/* ── step 1: identity ── */}
        <section className="mb-12">
          <StepHeading
            step="one"
            title="Your acting name"
            hint="Pick yourself from the list to load your credits."
          />

          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (person) setPerson(null);
              }}
              placeholder="e.g. Florence Pugh"
              autoComplete="off"
              className="w-full px-4 py-3 text-base outline-none transition focus:border-[--color-accent]"
              style={inputStyle}
            />
            {searching && (
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: "var(--color-muted)" }}
              >
                Searching…
              </span>
            )}

            {people.length > 0 && (
              <ul
                className="absolute z-30 mt-1 w-full overflow-hidden"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-inset)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "0 8px 24px rgba(45,43,38,0.08)",
                }}
              >
                {people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void pickPerson(p)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[--color-surface]"
                    >
                      {p.profileImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.profileImageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 object-cover"
                          style={{ borderRadius: "var(--radius-sm)" }}
                        />
                      ) : (
                        <span
                          className="h-10 w-10 shrink-0"
                          style={{ background: "var(--color-surface)", borderRadius: "var(--radius-sm)" }}
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block text-sm" style={{ color: "var(--color-ink)" }}>
                          {p.name}
                        </span>
                        {p.knownFor.length > 0 && (
                          <span
                            className="block truncate text-xs"
                            style={{ color: "var(--color-muted)" }}
                          >
                            {p.knownFor.join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {person && (
            <div className="mt-3 flex items-center gap-3">
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                Showing credits for <strong style={{ color: "var(--color-ink)" }}>{person.name}</strong>
                {loadingCredits ? " — loading…" : ` — ${activeCredits.length} in the last ${assumptions.lookbackYears} years.`}
              </p>
              <button
                type="button"
                onClick={startOver}
                className="text-xs underline transition hover:opacity-60"
                style={{ color: "var(--color-muted)" }}
              >
                Not you?
              </button>
            </div>
          )}
        </section>

        {/* ── step 2: credits grid ── */}
        {person && !loadingCredits && activeCredits.length > 0 && (
          <section className="mb-12">
            <StepHeading
              step="two"
              title="Which jobs scanned you, and what you were paid"
              hint={`Tick Scanned where a body or face scan was taken, and add your fee. Your earliest scan opens a ${assumptions.scanCycleYears}-year cycle — every scan inside it could have licensed that one instead, at ${(assumptions.relicenceRate * 100).toFixed(1)}% of your fee. Tick Reshoots for pickups.`}
            />

            {/* bulk controls */}
            <div
              className="mb-4 flex flex-wrap items-center gap-2 px-3 py-3"
              style={{
                background: "var(--color-surface)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                Quick fill
              </span>
              <div className="flex items-center">
                <span
                  className="px-2 py-1.5 text-sm"
                  style={{ color: "var(--color-muted)" }}
                >
                  {symbol}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={bulkFee}
                  onChange={(e) => setBulkFee(e.target.value)}
                  placeholder="Typical fee"
                  className="w-32 px-2 py-1.5 text-sm outline-none focus:border-[--color-accent]"
                  style={inputStyle}
                />
              </div>
              <button
                type="button"
                onClick={() => applyBulkFee(false)}
                className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                style={{ ...inputStyle, color: "var(--color-ink)" }}
              >
                Apply to all
              </button>
              <button
                type="button"
                onClick={() => applyBulkFee(true)}
                className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                style={{ ...inputStyle, color: "var(--color-ink)" }}
              >
                Fill the blanks
              </button>

              <span className="mx-1 hidden h-4 w-px sm:block" style={{ background: "var(--color-border)" }} />

              <button
                type="button"
                onClick={() => setAllScanned(true)}
                className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                style={{ ...inputStyle, color: "var(--color-ink)" }}
              >
                Scan all
              </button>
              <button
                type="button"
                onClick={() => setAllScanned(false)}
                className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                style={{ ...inputStyle, color: "var(--color-ink)" }}
              >
                Clear scans
              </button>

              <span className="ml-auto flex items-center gap-1">
                {CURRENCIES.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCurrency(c.code)}
                    aria-pressed={currency === c.code}
                    className="px-2.5 py-1.5 text-xs font-medium transition"
                    style={{
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${currency === c.code ? "var(--color-accent)" : "var(--color-border)"}`,
                      background: currency === c.code ? "var(--color-accent-tint)" : "var(--color-inset)",
                      color: currency === c.code ? "var(--color-accent)" : "var(--color-muted)",
                    }}
                  >
                    {c.symbol}
                  </button>
                ))}
              </span>
            </div>

            {/* The single biggest way to understate the number: marking scans but
                only pricing those rows. Say it, and make the fix one click. */}
            {result.relicensableWithoutFee > 0 && (
              <div
                className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                style={{
                  border: "1px solid var(--color-accent)",
                  background: "var(--color-accent-tint)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <p className="text-xs" style={{ color: "var(--color-accent)", lineHeight: 1.5 }}>
                  {plural(result.relicensableWithoutFee, "scan", "scans")} could have re-licensed but
                  {result.relicensableWithoutFee === 1 ? " has" : " have"} no fee. The re-licence is a
                  share of that job&apos;s fee, so add one.
                </p>
                {bulkFee.trim() && (
                  <button
                    type="button"
                    onClick={() => applyBulkFee(true)}
                    className="ml-auto shrink-0 px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                    style={{ ...inputStyle, color: "var(--color-ink)" }}
                  >
                    Fill them with {money(toNumber(bulkFee), currency)}
                  </button>
                )}
              </div>
            )}

            {/* grid */}
            <div
              className="overflow-hidden"
              style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}
            >
              {activeCredits.map((credit, index) => {
                const row = rows[credit.id] ?? EMPTY_ROW;
                const outcome = outcomeById.get(credit.id);
                return (
                  <div
                    key={credit.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pr-3"
                    style={{
                      borderTop: index === 0 ? "none" : "1px solid var(--color-border)",
                      background: row.scanned ? "var(--color-surface)" : "var(--color-inset)",
                      // A solid rule marks the capture that opens a cycle; the
                      // scans it carries get a lighter one, so a cycle reads as a
                      // block down the left edge of the grid.
                      paddingLeft: "calc(0.75rem - 3px)",
                      borderLeft: outcome?.isFirstScanOfCycle
                        ? "3px solid var(--color-accent)"
                        : outcome?.couldHaveUsedScanId
                          ? "3px solid var(--color-accent-tint)"
                          : "3px solid transparent",
                    }}
                  >
                    <span
                      className="w-10 shrink-0 font-mono text-xs"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {credit.year ?? "—"}
                    </span>

                    <span className="min-w-0 flex-1" style={{ flexBasis: "14rem" }}>
                      <span className="block truncate text-sm" style={{ color: "var(--color-ink)" }}>
                        {credit.title}
                        {credit.mediaType === "tv" && (
                          <span className="ml-2 text-xs" style={{ color: "var(--color-faint)" }}>
                            TV
                          </span>
                        )}
                      </span>
                      {outcome?.cycleIndex !== null && outcome?.cycleIndex !== undefined && (
                        <span
                          className="mt-0.5 inline-block text-xs font-medium tracking-wide uppercase"
                          style={{
                            color: outcome.isFirstScanOfCycle
                              ? "var(--color-accent)"
                              : "var(--color-muted)",
                          }}
                          title={
                            outcome.isFirstScanOfCycle
                              ? `This scan opens cycle ${outcome.cycleIndex}. Nothing was live when it was taken, so the capture was genuinely needed and earns no re-licence.`
                              : `Inside cycle ${outcome.cycleIndex} — this production could have licensed the scan that opened it.`
                          }
                        >
                          {outcome.isFirstScanOfCycle
                            ? `◆ Opens cycle ${outcome.cycleIndex}`
                            : `Cycle ${outcome.cycleIndex}`}
                        </span>
                      )}
                      {credit.character && (
                        <span className="block truncate text-xs" style={{ color: "var(--color-muted)" }}>
                          {credit.character}
                        </span>
                      )}
                    </span>

                    <span className="flex items-center">
                      <span className="pr-1 text-sm" style={{ color: "var(--color-muted)" }}>
                        {symbol}
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.fee}
                        onChange={(e) => updateRow(credit.id, { fee: e.target.value })}
                        placeholder="Fee"
                        aria-label={`Your fee for ${credit.title}`}
                        className="w-28 px-2 py-1.5 text-sm outline-none focus:border-[--color-accent]"
                        style={inputStyle}
                      />
                    </span>

                    <Toggle
                      active={row.scanned}
                      onClick={() => updateRow(credit.id, { scanned: !row.scanned })}
                      label="Scanned"
                      title="This production took a body or face scan"
                    />
                    <Toggle
                      active={row.reshoots}
                      onClick={() => updateRow(credit.id, { reshoots: !row.reshoots })}
                      label="Reshoots"
                      title="This production went back for pickups or reshoots"
                    />

                    {/* A covered row with no fee is the one leaving money on the
                        table, so it says so rather than showing a bare dash. */}
                    {outcome && outcome.total === 0 && outcome.couldHaveUsedScanId && outcome.fee <= 0 ? (
                      <span
                        className="w-24 shrink-0 text-right text-xs"
                        style={{ color: "var(--color-accent)" }}
                        title={`A scan of yours was already live when this production scanned you — add your fee and it earns ${(assumptions.relicenceRate * 100).toFixed(1)}%.`}
                      >
                        Add fee
                      </span>
                    ) : (
                      <span
                        className="w-24 shrink-0 text-right font-mono text-xs"
                        style={{
                          color: outcome && outcome.total > 0 ? "var(--color-accent)" : "var(--color-faint)",
                        }}
                      >
                        {outcome && outcome.total > 0 ? `+${money(outcome.total, currency)}` : "—"}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => dropCredit(credit.id)}
                      aria-label={`Remove ${credit.title}`}
                      title="Not one of mine — remove it"
                      className="shrink-0 px-1 text-sm transition hover:opacity-100"
                      style={{ color: "var(--color-faint)" }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Why some scanned rows earn nothing. Without this the anchors read
                as a bug rather than as the capture that had to happen. */}
            {result.cycleCount > 0 && (
              <p className="mt-2.5 text-xs" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                <span style={{ color: "var(--color-accent)" }}>◆</span> opens a cycle — nothing was
                live when it was taken, so it earns nothing. Every scan inside that cycle could have
                licensed it instead.{" "}
                {result.cycleCount === 1
                  ? `Your scans form one cycle.`
                  : `Your scans form ${result.cycleCount} cycles.`}
              </p>
            )}

            {dropped.size > 0 && (
              <button
                type="button"
                onClick={() => setDropped(new Set())}
                className="mt-2 text-xs underline transition hover:opacity-60"
                style={{ color: "var(--color-muted)" }}
              >
                Restore {dropped.size} removed {dropped.size === 1 ? "credit" : "credits"}
              </button>
            )}
          </section>
        )}

        {person && !loadingCredits && credits.length === 0 && (
          <section className="mb-12">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              No credits on file for the last {assumptions.lookbackYears} years under that name. Try
              another spelling, or{" "}
              <Link href="/register-interest" className="underline" style={{ color: "var(--color-accent)" }}>
                talk to us directly
              </Link>
              .
            </p>
          </section>
        )}

        {/* ── step 3: advertising ── */}
        {person && activeCredits.length > 0 && (
          <section className="mb-12">
            <StepHeading
              step="three"
              title="Advertising and branded content"
              hint="Work that could run off an existing scan, with no shoot day. Your estimate, per year."
            />
            <div className="flex flex-wrap gap-6">
              <label className="block">
                <span
                  className="mb-1.5 block text-xs font-medium tracking-wide uppercase"
                  style={{ color: "var(--color-muted)" }}
                >
                  Engagements per year
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={adsPerYear}
                  onChange={(e) => setAdsPerYear(e.target.value)}
                  placeholder="2"
                  className="w-36 px-3 py-2.5 text-sm outline-none focus:border-[--color-accent]"
                  style={inputStyle}
                />
              </label>
              <label className="block">
                <span
                  className="mb-1.5 block text-xs font-medium tracking-wide uppercase"
                  style={{ color: "var(--color-muted)" }}
                >
                  Average fee ({symbol})
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={adFee}
                  onChange={(e) => setAdFee(e.target.value)}
                  placeholder="15000"
                  className="w-40 px-3 py-2.5 text-sm outline-none focus:border-[--color-accent]"
                  style={inputStyle}
                />
              </label>
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--color-muted)" }}>
              Counted for the {formatYears(result.coveredYears)} a scan of yours was live.
            </p>
          </section>
        )}

        {/* ── assumptions ── */}
        {person && activeCredits.length > 0 && (
          <section className="mb-12">
            <button
              type="button"
              onClick={() => setShowAssumptions((v) => !v)}
              className="text-xs font-medium tracking-widest uppercase underline transition hover:opacity-60"
              style={{ color: "var(--color-muted)" }}
            >
              {showAssumptions ? "Hide" : "Show"} the assumptions
            </button>

            {showAssumptions && (
              <div
                className="mt-4 px-4 py-4"
                style={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <p className="mb-4 text-sm" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
                  Your earliest scan opens a cycle running {assumptions.scanCycleYears} years from
                  the day it was taken. Every scan inside that cycle could have licensed it instead
                  of commissioning its own, at {(assumptions.relicenceRate * 100).toFixed(1)}% of
                  your fee for that job. The scan that opens a cycle earns nothing; once the cycle
                  lapses, the next scan opens a fresh one. Reshoots pay{" "}
                  {(assumptions.reshootRate * 100).toFixed(1)}%, and advertising counts for as long
                  as any scan was live. Illustrative rates, not quoted terms.
                </p>
                <div className="flex flex-wrap gap-5">
                  <label className="block">
                    <span className="mb-1.5 block text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                      Scan cycle (years)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={assumptions.scanCycleYears}
                      onChange={(e) =>
                        setAssumptions((a) => ({ ...a, scanCycleYears: Number(e.target.value) || 0 }))
                      }
                      className="w-24 px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                      style={inputStyle}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                      Re-licence rate (%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={assumptions.relicenceRate * 100}
                      onChange={(e) =>
                        setAssumptions((a) => ({ ...a, relicenceRate: (Number(e.target.value) || 0) / 100 }))
                      }
                      className="w-24 px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                      style={inputStyle}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                      Reshoot rate (%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={assumptions.reshootRate * 100}
                      onChange={(e) =>
                        setAssumptions((a) => ({ ...a, reshootRate: (Number(e.target.value) || 0) / 100 }))
                      }
                      className="w-24 px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                      style={inputStyle}
                    />
                  </label>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── result ──
            No running total and no reveal: one figure, in place, updating as
            the sheet is filled in. */}
        {person && activeCredits.length > 0 && (
          <section className="mb-12">
            <div
              className="px-6 py-8"
              style={{
                background: "var(--color-ink)",
                borderRadius: "var(--radius)",
                color: "var(--color-bg)",
              }}
            >
              <p
                className="text-xs font-medium tracking-widest uppercase"
                style={{ color: "var(--color-salmon)" }}
              >
                Left on the table
              </p>
              <p
                className="mt-3 text-5xl font-medium md:text-6xl"
                style={{ fontFamily: "var(--font-serif)", lineHeight: 1 }}
              >
                {money(result.total, currency)}
              </p>
              <p className="mt-3 max-w-xl text-sm" style={{ color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
                Over {assumptions.lookbackYears} years, on top of the{" "}
                {money(result.feeTotal, currency)} you were paid
                {result.upliftPercent !== null && ` — up ${result.upliftPercent.toFixed(1)}%`}.
              </p>

              <dl className="mt-7 grid gap-5 sm:grid-cols-3">
                {[
                  {
                    label: `Re-licensing (${(assumptions.relicenceRate * 100).toFixed(1)}%)`,
                    value: result.relicenceTotal,
                    note: relicenceNote(
                      result.relicensableCount,
                      result.relicensableWithoutFee,
                      result.cycleCount,
                    ),
                  },
                  {
                    label: `Reshoots (${(assumptions.reshootRate * 100).toFixed(1)}%)`,
                    value: result.reshootTotal,
                    note: `${result.reshootCount} ${result.reshootCount === 1 ? "production" : "productions"} with pickups`,
                  },
                  {
                    label: "Advertising & content",
                    value: result.advertisingTotal,
                    note: `${formatYears(result.coveredYears)} with a live scan`,
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <dt
                      className="text-xs font-medium tracking-wide uppercase"
                      style={{ color: "rgba(255,255,255,0.55)" }}
                    >
                      {item.label}
                    </dt>
                    <dd className="mt-1 font-mono text-xl">{money(item.value, currency)}</dd>
                    <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {item.note}
                    </p>
                  </div>
                ))}
              </dl>
            </div>

            {/* CTA */}
            <div
              className="mt-6 px-6 py-7"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                background: "var(--color-surface)",
              }}
            >
              <h3
                className="text-xl font-medium"
                style={{ color: "var(--color-ink)", fontFamily: "var(--font-serif)" }}
              >
                None of that reaches you unless the scan is yours to license.
              </h3>
              <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
                ImageVault puts your scan packages behind your own gate — you hold them, productions
                request access, and every download is on the record.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={signupHref}
                  className="btn-accent px-6 py-3 text-xs font-medium tracking-wide uppercase text-white transition"
                >
                  Claim your vault
                </Link>
                <button
                  type="button"
                  onClick={() => setShareOpen((v) => !v)}
                  aria-expanded={shareOpen}
                  className="px-6 py-3 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                  style={{ ...inputStyle, color: "var(--color-ink)" }}
                >
                  {shareOpen ? "Hide share options" : "Share this sheet"}
                </button>
              </div>
              <p className="mt-4 text-xs" style={{ color: "var(--color-muted)" }}>
                Talent accounts are invite-only while we onboard.
              </p>
            </div>

            {/* ── share panel ── */}
            {shareOpen && (
              <div
                className="mt-4 px-6 py-6"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  background: "var(--color-inset)",
                }}
              >
                <Eyebrow>Hand this over</Eyebrow>
                <h4
                  className="mt-1 text-lg font-medium"
                  style={{ color: "var(--color-ink)", fontFamily: "var(--font-serif)" }}
                >
                  Pass it on, filled in
                </h4>
                <p className="mt-1 max-w-xl text-sm" style={{ color: "var(--color-text)", lineHeight: 1.6 }}>
                  The link carries this whole sheet. Whoever opens it lands on this number and can
                  change anything they disagree with.
                </p>

                <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start">
                  {/* QR */}
                  <div className="shrink-0">
                    <div
                      className="inline-block p-3"
                      style={{ background: "#ffffff", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}
                    >
                      {shareUrl ? (
                        <QRCodeSVG
                          value={shareUrl}
                          size={168}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#2d2b26"
                          title="Scan to open this calculator sheet"
                        />
                      ) : (
                        <div style={{ width: 168, height: 168 }} />
                      )}
                    </div>
                    <p className="mt-2 max-w-[190px] text-xs" style={{ color: "var(--color-muted)" }}>
                      Point a phone camera at this.
                    </p>
                  </div>

                  {/* Link + actions */}
                  <div className="min-w-0 flex-1">
                    <label
                      className="mb-1.5 block text-xs font-medium tracking-wide uppercase"
                      style={{ color: "var(--color-muted)" }}
                    >
                      Share link
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="Share link for this calculator sheet"
                      className="w-full px-3 py-2.5 font-mono text-xs outline-none"
                      style={inputStyle}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(shareUrl, "link")}
                        className="btn-accent px-4 py-2.5 text-xs font-medium tracking-wide uppercase text-white transition"
                      >
                        {copied === "link" ? "Link copied" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareNatively()}
                        className="px-4 py-2.5 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                        style={{ ...inputStyle, color: "var(--color-ink)" }}
                      >
                        {copied === "message" ? "Message copied" : "Send with a message"}
                      </button>
                    </div>

                    <p className="mt-4 text-xs" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
                      The figures live in the link, so anyone holding it can read your fees. Send it
                      to one person.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── footnote ── */}
        <p className="text-xs" style={{ color: "var(--color-faint)", lineHeight: 1.7 }}>
          Credits are drawn from public listings and may be incomplete — remove anything that
          isn&apos;t yours. Every figure is an illustration built from rates you can change, not an
          offer, a valuation, or advice.
        </p>
      </main>
    </div>
  );
}
