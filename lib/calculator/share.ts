/**
 * Share-link codec for the public calculator.
 *
 * An agent fills the grid in at their desk and hands the result to the
 * performer — so the whole working state has to travel in the link itself.
 * There is nowhere to put it but the URL: the calculator has no database, no
 * session and no server-side record, and adding one to support sharing would
 * trade away the thing that makes the page worth opening.
 *
 * The consequence is worth stating plainly, and the UI does: a share link
 * carries the fees someone typed. It is a private link to hand to one person,
 * not a public one — and the page says so next to the button.
 *
 * The payload is tuned to stay small enough to scan. Three things do the work:
 * credits with nothing marked on them are dropped entirely, numbers are base36,
 * and the fee shared by most credits is hoisted into a header so the common
 * "same fee on everything" case costs nothing per row. A twenty-credit sheet
 * lands near 150 characters.
 *
 * Every separator (`*` `-` `.`) and every payload character (0-9, A-Z) is both
 * unescaped by encodeURIComponent and inside QR's alphanumeric mode, so the code
 * stays in the compact 5.5-bits-per-character encoding rather than falling back
 * to 8-bit bytes.
 */

import {
  DEFAULT_ASSUMPTIONS,
  type CalculatorAssumptions,
} from "./model";
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "./currency";

/** Bumped only on a breaking payload change; older links then decode to null. */
const VERSION = "1";

const SECTION = "*";
const CREDIT = "-";
const FIELD = ".";

/** Guard rails on decoded values — a link is untrusted input like any other. */
const MAX_FEE = 1_000_000_000;
const MAX_CREDITS = 200;
const MAX_CYCLE_YEARS = 50;
const MAX_LOOKBACK_YEARS = 25;
const MAX_RATE_BP = 10_000; // 100%

const FLAG_SCANNED = 1;
const FLAG_RESHOOTS = 2;
const FLAG_DROPPED = 4;

export interface ShareCredit {
  /** Matches CalculatorCredit.id — "movie-550" or "tv-1396". */
  id: string;
  fee: number;
  scanned: boolean;
  reshoots: boolean;
  /** The sharer removed this credit from the grid as not theirs. */
  dropped: boolean;
}

export interface ShareState {
  personId: number;
  currency: CurrencyCode;
  credits: ShareCredit[];
  advertising: { engagementsPerYear: number; averageFee: number };
  assumptions: CalculatorAssumptions;
}

/* ────────────────────────────── base36 ────────────────────────────── */

function enc36(n: number): string {
  const safe = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return safe.toString(36).toUpperCase();
}

/** Returns null (not 0) for anything that isn't a clean base36 integer. */
function dec36(s: string): number | null {
  if (!/^[0-9A-Z]+$/.test(s)) return null;
  const n = parseInt(s, 36);
  return Number.isSafeInteger(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/* ─────────────────────────── credit ids ──────────────────────────── */

function splitCreditId(id: string): { marker: "M" | "T"; tmdbId: number } | null {
  const match = /^(movie|tv)-(\d+)$/.exec(id);
  if (!match) return null;
  const tmdbId = Number(match[2]);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
  return { marker: match[1] === "tv" ? "T" : "M", tmdbId };
}

function joinCreditId(marker: string, tmdbId: number): string | null {
  if (marker === "M") return `movie-${tmdbId}`;
  if (marker === "T") return `tv-${tmdbId}`;
  return null;
}

/* ──────────────────────────── encoding ───────────────────────────── */

/** The fee to hoist into the header — the one the most credits share. */
function modalFee(credits: ShareCredit[]): number {
  const counts = new Map<number, number>();
  for (const c of credits) {
    const fee = Math.round(c.fee);
    if (fee > 0) counts.set(fee, (counts.get(fee) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [fee, count] of counts) {
    if (count > bestCount) {
      best = fee;
      bestCount = count;
    }
  }
  return best;
}

function encodeAssumptions(a: CalculatorAssumptions): string {
  const same =
    a.scanCycleYears === DEFAULT_ASSUMPTIONS.scanCycleYears &&
    a.relicenceRate === DEFAULT_ASSUMPTIONS.relicenceRate &&
    a.reshootRate === DEFAULT_ASSUMPTIONS.reshootRate &&
    a.lookbackYears === DEFAULT_ASSUMPTIONS.lookbackYears;
  if (same) return "";

  return [
    enc36(a.scanCycleYears),
    enc36(Math.round(a.relicenceRate * 10_000)),
    enc36(Math.round(a.reshootRate * 10_000)),
    enc36(a.lookbackYears),
  ].join(FIELD);
}

/**
 * Pack a filled-in calculator into a URL-safe string.
 *
 * Credits carrying no information at all — no fee, not scanned, not flagged,
 * not removed — are left out; the recipient's own lookup supplies them.
 */
export function encodeShareState(state: ShareState): string {
  const meaningful = state.credits.filter(
    (c) => Math.round(c.fee) > 0 || c.scanned || c.reshoots || c.dropped,
  );
  const defaultFee = modalFee(meaningful);

  const creditTokens: string[] = [];
  for (const credit of meaningful.slice(0, MAX_CREDITS)) {
    const parsed = splitCreditId(credit.id);
    if (!parsed) continue;

    const flags =
      (credit.scanned ? FLAG_SCANNED : 0) |
      (credit.reshoots ? FLAG_RESHOOTS : 0) |
      (credit.dropped ? FLAG_DROPPED : 0);

    let token = `${flags}${parsed.marker}${enc36(parsed.tmdbId)}`;
    const fee = Math.round(credit.fee);
    if (fee !== defaultFee) token += `${FIELD}${enc36(fee)}`;
    creditTokens.push(token);
  }

  const currencyIndex = Math.max(
    0,
    CURRENCIES.findIndex((c) => c.code === state.currency),
  );

  return [
    VERSION,
    enc36(state.personId),
    String(currencyIndex),
    enc36(defaultFee),
    `${enc36(state.advertising.engagementsPerYear)}${FIELD}${enc36(state.advertising.averageFee)}`,
    encodeAssumptions(state.assumptions),
    creditTokens.join(CREDIT),
  ].join(SECTION);
}

/* ──────────────────────────── decoding ───────────────────────────── */

function decodeAssumptions(raw: string): CalculatorAssumptions {
  if (!raw) return DEFAULT_ASSUMPTIONS;

  const [cycle, relicence, reshoot, lookback] = raw.split(FIELD);
  const cycleYears = dec36(cycle ?? "");
  const relicenceBp = dec36(relicence ?? "");
  const reshootBp = dec36(reshoot ?? "");
  const lookbackYears = dec36(lookback ?? "");

  return {
    scanCycleYears:
      cycleYears === null ? DEFAULT_ASSUMPTIONS.scanCycleYears : clamp(cycleYears, 0, MAX_CYCLE_YEARS),
    relicenceRate:
      relicenceBp === null
        ? DEFAULT_ASSUMPTIONS.relicenceRate
        : clamp(relicenceBp, 0, MAX_RATE_BP) / 10_000,
    reshootRate:
      reshootBp === null
        ? DEFAULT_ASSUMPTIONS.reshootRate
        : clamp(reshootBp, 0, MAX_RATE_BP) / 10_000,
    lookbackYears:
      lookbackYears === null
        ? DEFAULT_ASSUMPTIONS.lookbackYears
        : clamp(lookbackYears, 1, MAX_LOOKBACK_YEARS),
  };
}

/**
 * Unpack a share payload. Returns null when it isn't one — a truncated link, a
 * future version, a hand-edited query string. Anything malformed *within* a
 * recognisable payload is dropped rather than throwing: a mangled row should
 * cost that row, not the whole sheet.
 */
export function decodeShareState(raw: string | null | undefined): ShareState | null {
  if (!raw) return null;

  const sections = raw.split(SECTION);
  if (sections.length < 7) return null;
  if (sections[0] !== VERSION) return null;

  const personId = dec36(sections[1]);
  if (personId === null || personId <= 0) return null;

  const currencyIndex = Number(sections[2]);
  const currency: CurrencyCode =
    Number.isInteger(currencyIndex) && CURRENCIES[currencyIndex]
      ? CURRENCIES[currencyIndex].code
      : DEFAULT_CURRENCY;

  const defaultFee = clamp(dec36(sections[3]) ?? 0, 0, MAX_FEE);

  const [adsRaw, adFeeRaw] = sections[4].split(FIELD);
  const advertising = {
    engagementsPerYear: clamp(dec36(adsRaw ?? "") ?? 0, 0, 1_000),
    averageFee: clamp(dec36(adFeeRaw ?? "") ?? 0, 0, MAX_FEE),
  };

  const assumptions = decodeAssumptions(sections[5]);

  // Rejoin any trailing sections: a stray separator shouldn't truncate the grid.
  const creditsRaw = sections.slice(6).join(SECTION);
  const credits: ShareCredit[] = [];
  const seen = new Set<string>();

  if (creditsRaw) {
    for (const token of creditsRaw.split(CREDIT).slice(0, MAX_CREDITS)) {
      const match = /^([0-7])([MT])([0-9A-Z]+)(?:\.([0-9A-Z]+))?$/.exec(token);
      if (!match) continue;

      const tmdbId = dec36(match[3]);
      if (tmdbId === null || tmdbId <= 0) continue;

      const id = joinCreditId(match[2], tmdbId);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const flags = Number(match[1]);
      const fee = match[4] === undefined ? defaultFee : (dec36(match[4]) ?? 0);

      credits.push({
        id,
        fee: clamp(fee, 0, MAX_FEE),
        scanned: (flags & FLAG_SCANNED) !== 0,
        reshoots: (flags & FLAG_RESHOOTS) !== 0,
        dropped: (flags & FLAG_DROPPED) !== 0,
      });
    }
  }

  return { personId, currency, credits, advertising, assumptions };
}

/** The query parameter a share payload travels in. */
export const SHARE_PARAM = "s";

/** Absolute share URL — absolute because a QR code is scanned from elsewhere. */
export function buildShareUrl(origin: string, state: ShareState): string {
  const url = new URL("/calculator", origin);
  url.searchParams.set(SHARE_PARAM, encodeShareState(state));
  return url.toString();
}
