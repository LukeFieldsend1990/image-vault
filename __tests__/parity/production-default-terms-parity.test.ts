import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Production default-terms parity guardrail.
 *
 * Invariant: the admin concierge invite form at /admin/productions/invite is a
 * staff-driven mirror of the self-serve /productions/setup wizard. The "default
 * licence terms" the concierge captures pre-tick each performer's consent
 * document, so the field set MUST stay aligned with the consent-form taxonomy
 * (lib/consent/use-categories.ts) and with whatever the main onboarding wizard
 * collects.
 *
 * This test fails when the two surfaces drift — e.g. the wizard gains an
 * isRelicense flag and the concierge form doesn't, or the concierge regresses
 * back to a single licenceType select while the wizard uses USE_CATEGORIES.
 *
 * The checks are deliberately textual (source-scan) rather than rendering: they
 * are fast, run on the source of truth, and surface the drift as a diff in CI.
 */

const ROOT = process.cwd();

const SETUP_CLIENT = join(ROOT, "app", "(vault)", "productions", "setup", "setup-client.tsx");
const CONCIERGE_CLIENT = join(ROOT, "app", "(vault)", "admin", "productions", "invite", "concierge-client.tsx");
const CONCIERGE_ROUTE = join(ROOT, "app", "api", "admin", "productions", "concierge", "route.ts");
const DEFAULT_TERMS_ROUTE = join(ROOT, "app", "api", "productions", "[id]", "default-terms", "route.ts");

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// Markers that must appear in BOTH the onboarding wizard and the concierge form
// — these are the consent-aligned defaults-capture fields. If you add one to the
// wizard, add it here too and propagate to the concierge form.
const SHARED_CLIENT_MARKERS: { marker: string | RegExp; description: string }[] = [
  { marker: 'from "@/lib/consent/use-categories"', description: "imports the consent use-category taxonomy" },
  { marker: "USE_CATEGORIES.map(", description: "renders the §39 use-category multi-select" },
  { marker: "useCategoryIds", description: "tracks the chosen use-category ids in form state" },
  { marker: "isRelicense", description: "captures the re-licence flag (item 9)" },
  { marker: "feeNA", description: "captures the Fee N/A toggle (item 9 — N/A is distinct from £0)" },
  { marker: /setMonth\(.+?\+\s*18\)/, description: "suggests an 18-month validity window when a start date is set" },
];

// Markers that must appear in BOTH API routes that persist defaultTerms — they
// share the consent-reconciliation contract so the legacy permitAiTraining
// boolean and the §39G `training` category can't drift apart.
const SHARED_ROUTE_MARKERS: { marker: string; description: string }[] = [
  { marker: "reconcileTrainingFlag", description: "reconciles the legacy permitAiTraining flag with the §39G training category" },
  { marker: "serializeUseCategoryIds", description: "serialises the validated use-category id list to JSON" },
  { marker: "useCategoriesJson", description: "persists the use-category ids onto productionDefaultTerms.useCategoriesJson" },
  { marker: "isRelicense", description: "persists the re-licence flag (item 9)" },
];

// Markers that MUST NOT reappear in the concierge form. These are legacy
// licensing controls that the consent-aligned model replaced — flag them so the
// concierge can't quietly regress back to the old taxonomy.
const CONCIERGE_REGRESSION_MARKERS: { marker: string; description: string }[] = [
  { marker: "CAST_LICENCE_TYPES", description: "legacy single licenceType select replaced by USE_CATEGORIES" },
  { marker: "LICENCE_TYPE_LABELS", description: "label table for the legacy licenceType select" },
];

describe("production default-terms parity (/productions/setup ↔ /admin/productions/invite)", () => {
  it("the concierge client and onboarding wizard share the consent-aligned field set", () => {
    const setupSrc = read(SETUP_CLIENT);
    const conciergeSrc = read(CONCIERGE_CLIENT);

    const missing: string[] = [];
    for (const { marker, description } of SHARED_CLIENT_MARKERS) {
      const test = (src: string) => (typeof marker === "string" ? src.includes(marker) : marker.test(src));
      if (!test(setupSrc)) missing.push(`setup-client.tsx is missing: ${description} (${marker})`);
      if (!test(conciergeSrc)) missing.push(`concierge-client.tsx is missing: ${description} (${marker})`);
    }
    expect(
      missing,
      `Concierge invite form drifted from the production onboarding wizard. Update the ` +
        `lagging surface so both capture the same consent-aligned defaults:\n  - ` +
        missing.join("\n  - "),
    ).toEqual([]);
  });

  it("the concierge API and canonical default-terms PUT route share the consent-reconciliation contract", () => {
    const conciergeRouteSrc = read(CONCIERGE_ROUTE);
    const defaultTermsRouteSrc = read(DEFAULT_TERMS_ROUTE);

    const missing: string[] = [];
    for (const { marker, description } of SHARED_ROUTE_MARKERS) {
      if (!conciergeRouteSrc.includes(marker)) {
        missing.push(`app/api/admin/productions/concierge/route.ts is missing: ${description} (${marker})`);
      }
      if (!defaultTermsRouteSrc.includes(marker)) {
        missing.push(`app/api/productions/[id]/default-terms/route.ts is missing: ${description} (${marker})`);
      }
    }
    expect(
      missing,
      `Default-terms persistence drifted between the concierge POST and the canonical PUT. ` +
        `Both must reconcile use-categories the same way so consent forms stay consistent:\n  - ` +
        missing.join("\n  - "),
    ).toEqual([]);
  });

  it("the concierge client has not regressed to the legacy single licenceType taxonomy", () => {
    const conciergeSrc = read(CONCIERGE_CLIENT);
    const regressions: string[] = [];
    for (const { marker, description } of CONCIERGE_REGRESSION_MARKERS) {
      if (conciergeSrc.includes(marker)) {
        regressions.push(`${marker} — ${description}`);
      }
    }
    expect(
      regressions,
      `concierge-client.tsx has regressed to the pre-consent licensing taxonomy. Remove these ` +
        `legacy references and use USE_CATEGORIES from lib/consent/use-categories.ts instead:\n  - ` +
        regressions.join("\n  - "),
    ).toEqual([]);
  });
});
