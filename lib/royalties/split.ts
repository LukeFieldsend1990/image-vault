/**
 * Royalty split maths for the Live Royalty Meter (SPEC §15.4).
 *
 * All amounts are integer pence. The platform share is computed as the
 * remainder so that talent + agency + platform always equals gross with no
 * rounding leakage.
 */

export interface SplitPcts {
  talentSharePct: number;
  agencySharePct: number;
  platformSharePct: number;
}

export interface RoyaltySplit {
  grossPence: number;
  talentPence: number;
  agencyPence: number;
  platformPence: number;
}

/** Default split when a talent has no talent_settings row. */
export const DEFAULT_SPLIT: SplitPcts = {
  talentSharePct: 80,
  agencySharePct: 10,
  platformSharePct: 10,
};

/**
 * Compute gross = units × unitRatePence, then split by percentages.
 * Talent and agency are floored; platform takes the remainder.
 */
export function computeRoyalty(
  units: number,
  unitRatePence: number,
  pcts: SplitPcts = DEFAULT_SPLIT,
): RoyaltySplit {
  const safeUnits = Math.max(0, Math.floor(units));
  const safeRate = Math.max(0, Math.floor(unitRatePence));
  const grossPence = safeUnits * safeRate;

  const talentPence = Math.floor((grossPence * pcts.talentSharePct) / 100);
  const agencyPence = Math.floor((grossPence * pcts.agencySharePct) / 100);
  const platformPence = grossPence - talentPence - agencyPence;

  return { grossPence, talentPence, agencyPence, platformPence };
}
