"use client";

/**
 * The public scan-value calculator.
 *
 * Everything here runs in the browser on state the visitor types. The only
 * network calls are two anonymous GETs that proxy TMDB for names and credits —
 * no fees, no scan markings and no totals ever leave the page. That promise is
 * the reason a working actor will try this, so it is stated on the page too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Wordmark from "@/app/components/wordmark";
import {
  calculate,
  DEFAULT_ASSUMPTIONS,
  type CalculatorAssumptions,
  type CreditInput,
} from "@/lib/calculator/model";
import type { CalculatorCredit, CalculatorPerson } from "@/lib/calculator/tmdb";

type CurrencyCode = "GBP" | "USD" | "EUR";

// Each currency is formatted in a locale that renders its own symbol bare —
// en-GB spells USD "US$67,000", which reads as a conversion rather than a fee.
const CURRENCIES: Array<{ code: CurrencyCode; symbol: string; locale: string }> = [
  { code: "GBP", symbol: "£", locale: "en-GB" },
  { code: "USD", symbol: "$", locale: "en-US" },
  { code: "EUR", symbol: "€", locale: "en-IE" },
];

interface RowState {
  fee: string;
  scanned: boolean;
  reshoots: boolean;
}

const EMPTY_ROW: RowState = { fee: "", scanned: false, reshoots: false };

function money(amount: number, currency: CurrencyCode): string {
  const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-GB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

  // Reveal
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? "£";

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
      setRevealed(false);
      setLoadingCredits(true);
      try {
        const res = await fetch(
          `/api/calculator/credits?personId=${picked.id}&years=${DEFAULT_ASSUMPTIONS.lookbackYears}`,
        );
        const data = (await res.json()) as { credits?: CalculatorCredit[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Couldn't load credits");
        const loaded = data.credits ?? [];
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

  function startOver() {
    setPerson(null);
    setQuery("");
    setPeople([]);
    setCredits([]);
    setRows({});
    setDropped(new Set());
    setRevealed(false);
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

  const hasSomethingToShow = result.total > 0;

  function reveal() {
    setRevealed(true);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function shareResult() {
    const text = `Over the last ${assumptions.lookbackYears} years, re-licensing my scans would have been worth ${money(result.total, currency)}. Work out yours: https://imagevault.ai/calculator`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "What is my scan worth?", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
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

      <main className="mx-auto max-w-4xl px-5 pb-40 pt-12">
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
            You were scanned on a job. That scan didn&apos;t stop working when the shoot wrapped —
            it stayed usable for years, on productions you were never asked about. Pull your last{" "}
            {assumptions.lookbackYears} years of credits, mark the ones that scanned you, and see
            what re-licensing that scan on your terms would have been worth.
          </p>
          <p
            className="mt-4 inline-block px-3 py-1.5 text-xs"
            style={{
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            Nothing you type here is stored. No account, no cookie, no record — close the tab and
            it&apos;s gone.
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

        {/* ── step 1: identity ── */}
        <section className="mb-12">
          <StepHeading
            step="one"
            title="Your acting name"
            hint="We match it to the public credits database. Pick yourself from the list."
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
              title="Mark the jobs that scanned you, and what you were paid"
              hint="Tick Scanned for any production that took a body or face scan. Tick Reshoots if it went back for pickups. Fees stay on this page."
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
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                    style={{
                      borderTop: index === 0 ? "none" : "1px solid var(--color-border)",
                      background: row.scanned ? "var(--color-surface)" : "var(--color-inset)",
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

                    <span
                      className="w-24 shrink-0 text-right font-mono text-xs"
                      style={{
                        color: outcome && outcome.total > 0 ? "var(--color-accent)" : "var(--color-faint)",
                      }}
                    >
                      {outcome && outcome.total > 0 ? `+${money(outcome.total, currency)}` : "—"}
                    </span>

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
              hint="Campaigns and content that could run off an existing scan with no shoot day. Your estimate, per year."
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
              Counted only for the {formatYears(result.coveredYears)} a scan of yours was live —
              mark more productions as scanned and this grows.
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
                  A scan taken on one production stays usable for a cycle of{" "}
                  {assumptions.scanCycleYears} years. Any other credit inside that cycle could have
                  been served by re-licensing it rather than commissioning a new capture, at{" "}
                  {(assumptions.relicenceRate * 100).toFixed(1)}% of your fee on that job. Reshoots
                  are a second call on the same scan, at {(assumptions.reshootRate * 100).toFixed(1)}%.
                  These are illustrative rates, not quoted terms — change them and watch the number move.
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

        {/* ── results ── */}
        {revealed && (
          <section ref={resultsRef} className="mb-12 scroll-mt-24">
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
                What re-licensing your own scans could have earned over the last{" "}
                {assumptions.lookbackYears} years, on top of the{" "}
                {money(result.feeTotal, currency)} you were already paid
                {result.upliftPercent !== null && ` — an uplift of ${result.upliftPercent.toFixed(1)}%`}.
              </p>

              <dl className="mt-7 grid gap-5 sm:grid-cols-3">
                {[
                  {
                    label: `Re-licensing (${(assumptions.relicenceRate * 100).toFixed(1)}%)`,
                    value: result.relicenceTotal,
                    note: `${result.relicensableCount} ${result.relicensableCount === 1 ? "credit" : "credits"} inside a live scan cycle`,
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
                ImageVault puts your scan packages behind your own gate: you hold them, productions
                request access, and every download is time-limited, dual-approved and on the record.
                That is what turns the number above from a hypothetical into a line item.
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
                  onClick={() => void shareResult()}
                  className="px-6 py-3 text-xs font-medium tracking-wide uppercase transition hover:opacity-70"
                  style={{ ...inputStyle, color: "var(--color-ink)" }}
                >
                  {copied ? "Copied" : "Share your number"}
                </button>
              </div>
              <p className="mt-4 text-xs" style={{ color: "var(--color-muted)" }}>
                Talent accounts are invite-only while we onboard. Requesting access takes a minute
                and your figures above are not sent with it.
              </p>
            </div>
          </section>
        )}

        {/* ── footnote ── */}
        <p className="text-xs" style={{ color: "var(--color-faint)", lineHeight: 1.7 }}>
          Credits come from the public TMDB database and may be incomplete — remove anything that
          isn&apos;t yours. Every figure here is an illustration built from rates you can change, not
          an offer, a valuation, or advice. ImageVault does not store anything you enter on this page.
        </p>
      </main>

      {/* ── sticky running total ── */}
      {person && activeCredits.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 border-t"
          style={{
            borderColor: "var(--color-border)",
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
                Running total
              </p>
              <p
                className="font-mono text-xl"
                style={{ color: hasSomethingToShow ? "var(--color-accent)" : "var(--color-faint)" }}
              >
                {money(result.total, currency)}
              </p>
            </div>
            <p className="hidden text-xs sm:block" style={{ color: "var(--color-muted)" }}>
              {result.scannedCount} scanned · {result.relicensableCount} re-licensable ·{" "}
              {formatYears(result.coveredYears)} covered
            </p>
            <button
              type="button"
              onClick={reveal}
              disabled={!hasSomethingToShow}
              className="btn-accent ml-auto px-5 py-2.5 text-xs font-medium tracking-wide uppercase text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revealed ? "Back to the breakdown" : "Show my breakdown"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
