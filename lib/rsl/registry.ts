/**
 * Human Consent Registry federation — Phase 3 (manual bridge).
 *
 * RSL Media's registry (https://registry.rslmedia.org) has no public write API
 * yet — it's a partner-request programme, identity-verified, US/EU-only, on a
 * draft standard (see specs/RSL-CONSENT-REGISTRY-SPEC.md and the Notion brief).
 * So today we bridge manually: the talent registers on rslmedia.org, mirrors the
 * AI-consent posture we already derived, and pastes the resulting Human Consent
 * ID back here. When a write/lookup API opens, this module becomes the seam for a
 * programmatic adapter (the stored field + badge UI won't have to change).
 */

/** The public registry a talent claims their Human Consent ID from. */
export const HUMAN_CONSENT_REGISTRY_URL = "https://registry.rslmedia.org/";

/** Eligibility note to surface in the UI (registry is US/EU only at launch). */
export const REGISTRY_ELIGIBILITY_NOTE =
  "The Human Consent Registry is currently open to people in the US and EU only.";

/**
 * Validate / normalise a pasted Human Consent ID. The registry's exact ID format
 * isn't published, so we accept a conservative token shape rather than reject
 * legitimate IDs: 3–64 chars of letters, digits and . _ - (and stripped spaces).
 * Returns null when the input can't be a valid ID.
 */
export function normalizeHumanConsentId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(v)) return null;
  return v;
}
