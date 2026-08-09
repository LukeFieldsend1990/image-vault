/**
 * Scan value calculator — the maths behind /calculator.
 *
 * Pure functions, no I/O, no persistence. The public calculator runs this in the
 * browser on state the visitor typed; nothing here reads or writes a database.
 * It is exported so the same model can be unit-tested and, later, reused
 * server-side without dragging the UI along.
 *
 * The model in one paragraph: a scan stays commercially usable for a cycle
 * (three years by default). A production that scanned you is a production that
 * *needed* a scan — so if one of yours was already live, captured on another
 * production inside the preceding cycle, that production could have licensed
 * the existing scan instead of commissioning its own, and would have paid you a
 * percentage of your fee on that job (5%). The demand is what matters, which is
 * why the opportunity attaches to the scanned credits: a job that never scanned
 * you never needed a scan, so there was nothing there to re-licence. A credit
 * flagged as having reshoots is a second, smaller bite at the same apple (2%).
 * Separately, advertising and content engagements can run entirely off a live
 * scan, so they pay their full average fee for every year the scan was live.
 *
 * The first scan in a cycle earns nothing: there was no earlier scan to use, so
 * that capture was genuinely necessary and the full fee already covered it.
 *
 * These are illustrative rates, not quoted terms — the UI says so plainly and
 * lets the visitor change every one of them.
 */

export const DEFAULT_ASSUMPTIONS: CalculatorAssumptions = {
  scanCycleYears: 3,
  relicenceRate: 0.05,
  reshootRate: 0.02,
  lookbackYears: 10,
};

export interface CalculatorAssumptions {
  /** How long a captured scan stays licensable, in years. */
  scanCycleYears: number;
  /** Share of a later credit's fee earned by re-licensing an existing scan. */
  relicenceRate: number;
  /** Share of a credit's fee earned when that credit has reshoots. */
  reshootRate: number;
  /** How far back the calculator looks, in years. */
  lookbackYears: number;
}

/** One acting credit as the visitor has marked it up. */
export interface CreditInput {
  /** Stable key, e.g. "movie-1234". */
  id: string;
  /** ISO date (YYYY-MM-DD) or null when the title has no release date on file. */
  releaseDate: string | null;
  /** The visitor was body/face scanned on this production. */
  scanned: boolean;
  /** This production had reshoots. */
  reshoots: boolean;
  /** The visitor's fee for this credit, in whole currency units. */
  fee: number;
}

export interface AdvertisingInput {
  /** Advertising / branded content engagements per year that could run off a scan. */
  engagementsPerYear: number;
  /** Average fee per engagement. */
  averageFee: number;
}

export interface CreditOutcome {
  id: string;
  fee: number;
  /**
   * A scanned credit with no earlier scan to fall back on — the capture that
   * genuinely had to happen. Earns no re-licence.
   */
  isFirstScanOfCycle: boolean;
  /**
   * Which cycle this scan belongs to, 1-based, in date order. Null for a credit
   * that wasn't scanned or has no date to place it by.
   */
  cycleIndex: number | null;
  /**
   * Id of the live scan this production could have licensed instead of
   * commissioning its own. Null unless this credit was itself scanned.
   */
  couldHaveUsedScanId: string | null;
  relicenceValue: number;
  reshootValue: number;
  total: number;
}

export interface CalculatorResult {
  credits: CreditOutcome[];
  /**
   * How long a scan was live, in years, across the lookback window. Overlapping
   * cycles are merged, so two scans a year apart give four years of cover, not
   * six. Fractional: a cycle that started in May contributes part-years at each
   * end rather than claiming both calendar years whole.
   */
  coveredYears: number;
  scannedCount: number;
  /**
   * How many cycles the marked scans fall into. Each one opens with a capture
   * that genuinely had to happen; everything after it inside the cycle is a
   * re-licence.
   */
  cycleCount: number;
  /**
   * Scanned productions that could have licensed the scan opening their cycle
   * instead of commissioning their own.
   */
  relicensableCount: number;
  /**
   * How many of those have no fee on them yet.
   *
   * A re-licence is charged against that production's own fee, so one with a
   * blank fee contributes nothing — which reads as a broken calculator when the
   * count beside it is non-zero. The UI uses this to say why.
   */
  relicensableWithoutFee: number;
  reshootCount: number;
  relicenceTotal: number;
  reshootTotal: number;
  advertisingTotal: number;
  /** Everything the scans would have earned on top of the fees already paid. */
  total: number;
  /** Sum of the declared fees, for context — money the visitor already earned. */
  feeTotal: number;
  /** total as a percentage of feeTotal, or null when no fees were declared. */
  upliftPercent: number | null;
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse YYYY-MM-DD to a UTC timestamp. Returns null for missing/malformed dates. */
function parseDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ts) ? null : ts;
}

/** Add whole years to a UTC timestamp, keeping month and day. */
function addYears(ts: number, years: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate());
}

function sanitiseMoney(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sanitiseCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Run the model.
 *
 * `now` is injected rather than read from the clock so the lookback window is
 * deterministic in tests.
 */
export function calculate(
  credits: CreditInput[],
  advertising: AdvertisingInput,
  assumptions: CalculatorAssumptions = DEFAULT_ASSUMPTIONS,
  now: Date = new Date(),
): CalculatorResult {
  const cycleYears = Math.max(0, assumptions.scanCycleYears);
  const relicenceRate = Math.max(0, assumptions.relicenceRate);
  const reshootRate = Math.max(0, assumptions.reshootRate);
  const lookbackYears = Math.max(1, Math.floor(assumptions.lookbackYears));

  // Every scan the visitor marked, oldest first. A scanned credit with no
  // release date still counts as a scan (it shows up in scannedCount) but can't
  // be placed in time, so it neither anchors a cycle nor claims one.
  const scans = credits
    .filter((c) => c.scanned)
    .map((c) => ({ id: c.id, at: parseDate(c.releaseDate) }))
    .filter((s): s is { id: string; at: number } => s.at !== null)
    .sort((a, b) => a.at - b.at);

  // Group the scans into cycles. The earliest scan opens the first cycle and is
  // the capture that had to happen; every scan falling inside that cycle could
  // have licensed it instead of commissioning its own. The first scan that lands
  // after the cycle expires opens the next one, and so on.
  //
  // The cycle is anchored on its opening scan, not measured backwards from each
  // scan in turn. A rolling look-back would chain indefinitely — every scan
  // propping up the next — and a scan captured six years after the first would
  // still read as a re-licence of something long expired. Anchoring is also what
  // the licence actually is: one capture, usable for three years from the day it
  // was taken.
  //
  // Anchoring on the earliest scan of each group is not merely the simplest
  // rule, it is the one that yields the fewest cycles and therefore the most
  // re-licensable scans: any later anchor would end its cycle sooner and could
  // only cover a subset.
  const anchorFor = new Map<string, string>();
  const cycleIndexFor = new Map<string, number>();
  const cycleAnchors: Array<{ id: string; at: number }> = [];
  let cycleEnd = -Infinity;
  let anchorId: string | null = null;

  for (const scan of scans) {
    if (scan.at >= cycleEnd) {
      anchorId = scan.id;
      cycleEnd = addYears(scan.at, cycleYears);
      cycleAnchors.push({ id: scan.id, at: scan.at });
    } else if (anchorId) {
      anchorFor.set(scan.id, anchorId);
    }
    cycleIndexFor.set(scan.id, cycleAnchors.length);
  }

  const outcomes: CreditOutcome[] = credits.map((credit) => {
    const fee = sanitiseMoney(credit.fee);

    // Only a production that scanned you can re-licence: a job that never
    // needed a scan had nothing to replace, however live your scan was.
    const couldHaveUsedScanId = anchorFor.get(credit.id) ?? null;

    const relicenceValue = couldHaveUsedScanId ? round2(fee * relicenceRate) : 0;
    // Reshoots are a separate opportunity and apply to any credit the visitor
    // flags, including the first capture in a cycle.
    const reshootValue = credit.reshoots ? round2(fee * reshootRate) : 0;

    return {
      id: credit.id,
      fee,
      // The first scan of a cycle: nothing earlier was available to re-use, so
      // this capture was genuinely needed and earns no re-licence.
      isFirstScanOfCycle: credit.scanned && couldHaveUsedScanId === null,
      cycleIndex: cycleIndexFor.get(credit.id) ?? null,
      couldHaveUsedScanId,
      relicenceValue,
      reshootValue,
      total: round2(relicenceValue + reshootValue),
    };
  });

  // How long a scan was live, clipped to the lookback window and to today —
  // advertising the visitor could have licensed in years that haven't happened
  // yet isn't money left on the table.
  const currentYear = now.getUTCFullYear();
  const lookbackStart = Date.UTC(currentYear - lookbackYears + 1, 0, 1);
  const nowTs = Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate());

  const clipped = scans
    .map((s) => ({
      start: Math.max(s.at, lookbackStart),
      end: Math.min(addYears(s.at, cycleYears), nowTs),
    }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping cycles so a year covered twice is still one year of cover.
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of clipped) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }

  const coveredDays = merged.reduce((sum, w) => sum + (w.end - w.start) / MS_PER_DAY, 0);
  const coveredYears = round2(coveredDays / DAYS_PER_YEAR);

  const engagementsPerYear = sanitiseCount(advertising.engagementsPerYear);
  const averageFee = sanitiseMoney(advertising.averageFee);
  const advertisingTotal = round2(engagementsPerYear * averageFee * coveredYears);

  const relicenceTotal = round2(outcomes.reduce((sum, o) => sum + o.relicenceValue, 0));
  const reshootTotal = round2(outcomes.reduce((sum, o) => sum + o.reshootValue, 0));
  const feeTotal = round2(outcomes.reduce((sum, o) => sum + o.fee, 0));
  const total = round2(relicenceTotal + reshootTotal + advertisingTotal);

  return {
    credits: outcomes,
    coveredYears,
    scannedCount: credits.filter((c) => c.scanned).length,
    cycleCount: cycleAnchors.length,
    relicensableCount: outcomes.filter((o) => o.couldHaveUsedScanId !== null).length,
    relicensableWithoutFee: outcomes.filter((o) => o.couldHaveUsedScanId !== null && o.fee <= 0).length,
    reshootCount: outcomes.filter((o) => o.reshootValue > 0).length,
    relicenceTotal,
    reshootTotal,
    advertisingTotal,
    total,
    feeTotal,
    upliftPercent: feeTotal > 0 ? round2((total / feeTotal) * 100) : null,
  };
}
