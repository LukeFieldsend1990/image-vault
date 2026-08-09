/**
 * Scan value calculator — the maths behind /calculator.
 *
 * Pure functions, no I/O, no persistence. The public calculator runs this in the
 * browser on state the visitor typed; nothing here reads or writes a database.
 * It is exported so the same model can be unit-tested and, later, reused
 * server-side without dragging the UI along.
 *
 * The model in one paragraph: a scan captured on a production stays commercially
 * usable for a cycle (three years by default). Any *other* credit that lands
 * inside that cycle could have been served by re-licensing the existing scan
 * instead of commissioning a fresh capture, and pays a percentage of that
 * credit's fee (5%). A credit flagged as having reshoots is a second, smaller
 * bite at the same apple (2%). Separately, advertising and content engagements
 * can run entirely off a live scan, so they pay their full average fee for every
 * year the scan was live.
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
  /** True when this credit is where a scan was captured. */
  isScanOrigin: boolean;
  /** Id of the scan whose cycle covers this credit, if any. */
  coveredByScanId: string | null;
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
  /** Credits that a live scan could have been re-licensed to. */
  relicensableCount: number;
  /**
   * How many of those have no fee on them yet.
   *
   * A re-licence is charged against the *later* job's fee, so a covered credit
   * with a blank fee contributes nothing — which reads as a broken calculator
   * when the count beside it is non-zero. The UI uses this to say why.
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

  // Scan cycles. A scanned credit with no release date still counts as a scan
  // (it shows up in scannedCount) but can't anchor a window in time.
  const windows = credits
    .filter((c) => c.scanned)
    .map((c) => ({ id: c.id, start: parseDate(c.releaseDate) }))
    .filter((w): w is { id: string; start: number } => w.start !== null)
    .map((w) => ({ id: w.id, start: w.start, end: addYears(w.start, cycleYears) }));

  const scanOriginIds = new Set(credits.filter((c) => c.scanned).map((c) => c.id));

  const outcomes: CreditOutcome[] = credits.map((credit) => {
    const fee = sanitiseMoney(credit.fee);
    const isScanOrigin = credit.scanned;
    const at = parseDate(credit.releaseDate);

    // A scan can be re-licensed to any *other* credit inside its cycle. The
    // origin production already paid a full fee, so it never earns a relicence.
    // First matching window wins — a credit inside two cycles is still one
    // re-licence, not two.
    let coveredByScanId: string | null = null;
    if (!isScanOrigin && at !== null) {
      const match = windows.find((w) => at >= w.start && at < w.end);
      coveredByScanId = match ? match.id : null;
    }

    const relicenceValue = coveredByScanId ? round2(fee * relicenceRate) : 0;
    // Reshoots are a separate opportunity and apply to any credit the visitor
    // flags, including the one the scan came from.
    const reshootValue = credit.reshoots ? round2(fee * reshootRate) : 0;

    return {
      id: credit.id,
      fee,
      isScanOrigin,
      coveredByScanId,
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

  const clipped = windows
    .map((w) => ({ start: Math.max(w.start, lookbackStart), end: Math.min(w.end, nowTs) }))
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
    scannedCount: scanOriginIds.size,
    relicensableCount: outcomes.filter((o) => o.coveredByScanId !== null).length,
    relicensableWithoutFee: outcomes.filter((o) => o.coveredByScanId !== null && o.fee <= 0).length,
    reshootCount: outcomes.filter((o) => o.reshootValue > 0).length,
    relicenceTotal,
    reshootTotal,
    advertisingTotal,
    total,
    feeTotal,
    upliftPercent: feeTotal > 0 ? round2((total / feeTotal) * 100) : null,
  };
}
