/**
 * Licence-type permission model.
 *
 * Licence types (the marketplace categories a licensee can request) and the
 * §39 use categories (standing instructions) share the same three states:
 *
 *   always ↔ allowed · case_by_case ↔ approval_required · never ↔ blocked
 *
 * Where a licence type overlaps a use category — `training_data` ("Training
 * Datasets") is the §39G "Training data for generative AI" category — the
 * standing instruction is the single source of truth: reads derive the
 * licence permission from it and writes go to the standing instruction, so
 * the two can never disagree. Licence types with no consent counterpart keep
 * their own `talentLicencePermissions` rows.
 */

import type { Disposition, StandingInstructionMap } from "./resolve";
import type { UseCategoryId } from "./use-categories";

export const LICENCE_TYPES = [
  "commercial",
  "film_double",
  "game_character",
  "ai_avatar",
  "training_data",
  "monitoring_reference",
] as const;

export type LicenceType = (typeof LICENCE_TYPES)[number];
export type LicencePermission = "allowed" | "approval_required" | "blocked";

export const LICENCE_PERMISSIONS: readonly LicencePermission[] = [
  "allowed",
  "approval_required",
  "blocked",
];

export const PERMISSION_DEFAULTS: Record<LicenceType, LicencePermission> = {
  commercial: "approval_required",
  film_double: "approval_required",
  game_character: "approval_required",
  ai_avatar: "approval_required",
  training_data: "blocked",
  monitoring_reference: "allowed",
};

/**
 * Licence types whose permission is owned by a standing-instruction use
 * category rather than a talentLicencePermissions row.
 */
export const LICENCE_TYPE_USE_CATEGORY: Partial<Record<LicenceType, UseCategoryId>> = {
  training_data: "training", // §39G
};

export function isLicenceType(v: unknown): v is LicenceType {
  return typeof v === "string" && (LICENCE_TYPES as readonly string[]).includes(v);
}

export function isLicencePermission(v: unknown): v is LicencePermission {
  return typeof v === "string" && (LICENCE_PERMISSIONS as readonly string[]).includes(v as LicencePermission);
}

export function dispositionToPermission(d: Disposition): LicencePermission {
  return d === "always" ? "allowed" : d === "never" ? "blocked" : "approval_required";
}

export function permissionToDisposition(p: LicencePermission): Disposition {
  return p === "allowed" ? "always" : p === "blocked" ? "never" : "case_by_case";
}

/**
 * Effective permission for every licence type: stored rows (falling back to
 * defaults), overlaid by standing instructions for consent-owned types. An
 * unset instruction falls back to the stored row / default so pre-existing
 * settings keep their meaning.
 */
export function resolveLicencePermissions(
  rows: readonly { licenceType: string; permission: string }[],
  instructions: StandingInstructionMap,
): { licenceType: LicenceType; permission: LicencePermission }[] {
  const stored = new Map(rows.map((r) => [r.licenceType, r.permission as LicencePermission]));
  return LICENCE_TYPES.map((type) => {
    const categoryId = LICENCE_TYPE_USE_CATEGORY[type];
    const disposition = categoryId ? instructions[categoryId] : undefined;
    return {
      licenceType: type,
      permission: disposition
        ? dispositionToPermission(disposition)
        : stored.get(type) ?? PERMISSION_DEFAULTS[type],
    };
  });
}
