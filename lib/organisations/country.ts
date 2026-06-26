/**
 * Country validation for industry organisations. Mirrors the production
 * country picker: a top-level jurisdiction id (UK | EU | US | CH | ...) plus a
 * country/region name that must match the regime's accepted sub-list.
 */

import { topLevelById, hasSubPick, subPickList } from "@/lib/jurisdictions/countries";

export interface NormalisedCountry {
  country: string;
  topLevelId: string;
}

export function validateCountry(
  country: unknown,
  topLevelId: unknown,
): NormalisedCountry | { error: string } {
  if (typeof country !== "string" || typeof topLevelId !== "string") {
    return { error: "country and countryTopLevelId must both be provided" };
  }
  const top = topLevelById(topLevelId);
  if (!top) return { error: "invalid countryTopLevelId" };
  const name = country.trim();
  if (!name) return { error: "country is required" };
  if (hasSubPick(topLevelId)) {
    if (!subPickList(topLevelId).includes(name)) return { error: `country must be one of the ${topLevelId} list` };
  } else if (name !== top.label) {
    return { error: `country must be "${top.label}" for ${topLevelId}` };
  }
  return { country: name, topLevelId };
}
