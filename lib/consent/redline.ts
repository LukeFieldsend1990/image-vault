/**
 * Negotiation redline — what changed between one position and the next.
 *
 * The thread already stores every proposed scope, fee and comment, but each
 * round has only ever been rendered in isolation, so a reader comparing round
 * three to round two does it by eye against two full lists. This computes the
 * delta instead.
 *
 * Three things about the underlying data shape this, and all three are traps:
 *
 *  1. **There is no stored round zero.** `licences.useCategoriesJson` is the
 *     producer's *current* offer and is overwritten by every producer counter,
 *     so by the time a thread has run it no longer holds the opening ask. The
 *     only durable record of a superseded offer is the ledger's
 *     `consent.counter_proposed` events. Callers that can reconstruct a baseline
 *     pass one; callers that cannot get a first round marked `isBaseline`, and
 *     the UI says so rather than implying a diff against an invented position.
 *
 *  2. **A `declined` round carries `scope: []`** — not because every use was
 *     withdrawn, but because the column is null and `mapRound` normalises null
 *     to an empty array. Diffing it against the previous position would render
 *     "removed: everything", which is a lie about what a decline means. Rounds
 *     that state no scope are marked `scopeStated: false` and produce no diff.
 *
 *  3. **`fee: null` is ambiguous** between "unchanged" and "explicitly cleared
 *     to N/A" — the tri-state that exists at the route layer is flattened to
 *     null on write. So a null fee is reported as *not stated*, never as a
 *     change to zero.
 *
 * Scope arrays arrive canonically ordered and deduped from
 * `normaliseUseCategoryIds`, so a set difference here is exact.
 */

import { USE_CATEGORIES, type UseCategoryId } from "./use-categories";
import type { NegotiationRound } from "./negotiation";

export interface RedlineEntry {
  round: NegotiationRound;
  /** True when this is the first position on record and has nothing to diff against. */
  isBaseline: boolean;
  /**
   * False when the round states no scope at all — a decline, or an accept that
   * carried none. Distinct from "stated an empty scope", which would be a real
   * refusal of every use.
   */
  scopeStated: boolean;
  /** Uses this position adds relative to the one before it, in taxonomy order. */
  added: UseCategoryId[];
  /** Uses this position removes relative to the one before it, in taxonomy order. */
  removed: UseCategoryId[];
  /** Uses carried over unchanged. Present so a reader can see the whole position. */
  unchanged: UseCategoryId[];
  /** Previous fee, when one was stated. */
  feeFrom: number | null;
  /** This round's fee, when one was stated. */
  feeTo: number | null;
  /** True only when both sides are stated and differ. */
  feeChanged: boolean;
  /** True when nothing at all moved — same scope, same fee. */
  unchangedEntirely: boolean;
}

const ORDER = new Map<string, number>(USE_CATEGORIES.map((c, i) => [c.id, i]));

function inTaxonomyOrder(ids: Iterable<UseCategoryId>): UseCategoryId[] {
  return [...ids].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
}

/**
 * A round states a scope when it is a position, not a verdict. `counter` and
 * `accepted` both carry a real position; `declined` ends the thread and its
 * empty scope means "none given".
 */
function statesScope(round: NegotiationRound): boolean {
  return round.action !== "declined";
}

export interface BuildRedlineInput {
  /** Thread rounds, ascending by round number. */
  rounds: NegotiationRound[];
  /**
   * The producer's opening position, where it can be reconstructed — from the
   * ledger, or from the current offer on a thread that has not yet been
   * countered. Omit when it is genuinely unknown; the first round then becomes
   * the baseline.
   */
  baseline?: { scope: UseCategoryId[]; fee: number | null } | null;
}

/**
 * Walk the thread, diffing each position against the one before it.
 *
 * Rounds that state no scope do not become the new comparison point — a decline
 * should not reset the baseline for anything after it (nothing normally follows
 * a decline, but a thread is not structurally prevented from continuing).
 */
export function buildRedline({ rounds, baseline }: BuildRedlineInput): RedlineEntry[] {
  const entries: RedlineEntry[] = [];

  let prevScope: Set<UseCategoryId> | null = baseline ? new Set(baseline.scope) : null;
  let prevFee: number | null = baseline ? baseline.fee : null;

  for (const round of rounds) {
    const scopeStated = statesScope(round);
    const isBaseline = prevScope === null && scopeStated;

    let added: UseCategoryId[] = [];
    let removed: UseCategoryId[] = [];
    let unchanged: UseCategoryId[] = [];

    if (scopeStated) {
      const current = new Set(round.scope);
      if (prevScope === null) {
        // Nothing to compare against: the whole position is the position.
        unchanged = inTaxonomyOrder(current);
      } else {
        added = inTaxonomyOrder([...current].filter((id) => !prevScope!.has(id)));
        removed = inTaxonomyOrder([...prevScope].filter((id) => !current.has(id)));
        unchanged = inTaxonomyOrder([...current].filter((id) => prevScope!.has(id)));
      }
    }

    const feeTo = round.fee;
    const feeFrom = prevFee;
    const feeChanged = feeTo !== null && feeFrom !== null && feeTo !== feeFrom;

    entries.push({
      round,
      isBaseline,
      scopeStated,
      added,
      removed,
      unchanged,
      feeFrom,
      feeTo,
      feeChanged,
      unchangedEntirely:
        scopeStated && !isBaseline && added.length === 0 && removed.length === 0 && !feeChanged,
    });

    if (scopeStated) {
      prevScope = new Set(round.scope);
      // A round that states no fee leaves the last stated fee standing, so the
      // next comparison is against a real number rather than against null.
      if (feeTo !== null) prevFee = feeTo;
    }
  }

  return entries;
}

/**
 * One-line summary of a redline entry, for a collapsed row.
 * Deliberately says "no change recorded" rather than nothing, so a round that
 * moved nothing is still visibly a round.
 */
export function summariseRedline(entry: RedlineEntry): string {
  if (!entry.scopeStated) return "No terms stated";
  if (entry.isBaseline) return `Opening position — ${entry.unchanged.length} use${entry.unchanged.length === 1 ? "" : "s"}`;

  const parts: string[] = [];
  if (entry.added.length) parts.push(`+${entry.added.length}`);
  if (entry.removed.length) parts.push(`−${entry.removed.length}`);
  if (entry.feeChanged) parts.push("fee revised");
  return parts.length ? parts.join(" · ") : "No change recorded";
}
