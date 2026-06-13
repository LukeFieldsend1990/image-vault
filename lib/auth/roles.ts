/**
 * Role helpers for the `licensee` → `industry` migration.
 *
 * `industry` renames and expands the old `licensee` role. During the
 * transition window both values coexist: legacy rows / sessions still carry
 * `licensee`, new ones carry `industry`. Always gate behaviour through
 * `isIndustryRole()` rather than comparing to a string literal so both
 * resolve identically. New code that needs to *assign* a role should use
 * `INDUSTRY_ROLE`.
 */

export const INDUSTRY_ROLE = "industry" as const;

/** Roles that can be selected at signup / invite / admin assignment. */
export type AssignableRole = "talent" | "rep" | "industry";

/** Any role persisted on users.role (admin is whitelist-only, never assigned). */
export type UserRole = AssignableRole | "licensee" | "admin";

/**
 * True for both the new `industry` role and the legacy `licensee` role.
 * Use everywhere a permission/visibility check previously read
 * `role === "licensee"`.
 */
export function isIndustryRole(role: string | null | undefined): boolean {
  return role === "industry" || role === "licensee";
}
