/**
 * Standing-instruction auto-routing resolver.
 *
 * Given the use categories a production is requesting and a performer's standing
 * instructions (per-category disposition), decide whether the request can be
 * resolved without a human.
 *
 * Conservative rule (legal default): only a UNANIMOUS set auto-resolves —
 *   - every requested use set to 'always' → auto-grant
 *   - every requested use set to 'never'  → auto-refuse
 *   - any 'case_by_case', any mix, or no instructions on file → route to a human
 *
 * Mirrors the prototype's ivResolveRequest. Pure function, no DB.
 */

import { getUseCategory } from "./use-categories";

export type Disposition = "always" | "case_by_case" | "never";

/** Map of useCategoryId → disposition. Missing keys are treated as case_by_case. */
export type StandingInstructionMap = Record<string, Disposition>;

export type ResolveResult =
  | { auto: false }
  | { auto: true; action: "granted" | "refused"; reason: string };

function labelFor(ids: readonly string[]): string {
  return ids.map((id) => getUseCategory(id)?.name ?? id).join(", ");
}

export function resolveRequest(
  usesRequested: readonly string[],
  instructions: StandingInstructionMap | null | undefined,
): ResolveResult {
  if (!instructions) return { auto: false }; // performer not registered / no instructions
  const uses = usesRequested.filter(Boolean);
  if (uses.length === 0) return { auto: false };

  const dispositions = uses.map((u) => instructions[u] ?? "case_by_case");

  if (dispositions.every((d) => d === "always")) {
    return {
      auto: true,
      action: "granted",
      reason: `Auto-granted per standing instructions (always grant for ${labelFor(uses)}).`,
    };
  }
  if (dispositions.every((d) => d === "never")) {
    return {
      auto: true,
      action: "refused",
      reason: `Auto-refused per standing instructions (never grant for ${labelFor(uses)}).`,
    };
  }
  return { auto: false };
}
