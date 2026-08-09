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
   * Scanned productions that could have licensed one of your existing scans
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

  const outcomes: CreditOutcome[] = credits.map((credit) => {
    const fee = sanitiseMoney(credit.fee);
    const at = parseDate(credit.releaseDate);

    // Look back a cycle from this production's date. If another production had
    // already scanned you inside that window, this one didn't need its own
    // capture — it could have licensed the live scan and paid you for it.
    //
    // The most recent qualifying scan is the one credited: it's the scan that
    // would actually have been offered, and it keeps the attribution to a
    // single source rather than double-counting overlapping cycles.
    let couldHaveUsedScanId: string | null = null;
    if (credit.scanned && at !== null) {
      const expiresAfter = addYears(at, -cycleYears);
      for (let i = scans.length - 1; i >= 0; i--) {
        const scan = scans[i];
        if (scan.id === credit.id) continue;
        // Strictly earlier, and not yet out of cycle. A scan exactly a cycle old
        // expired the moment this production started, so it doesn't count.
        if (scan.at < at && scan.at > expiresAfter) {
          couldHaveUsedScanId = scan.id;
          break;
        }
      }
    }

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
