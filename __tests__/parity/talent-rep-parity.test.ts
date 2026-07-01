import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Talent ↔ rep authorisation parity guardrail.
 *
 * Invariant: anything a TALENT can do, their REP (agent) should be able to do on
 * their behalf — reps act for the talent. So any API route that gates on the
 * `talent` role must ALSO accommodate reps (the `role === "rep"` + `hasRepAccess`
 * / `talentReps` delegation pattern), UNLESS the action is genuinely personal to
 * the talent and is explicitly whitelisted below with a reason.
 *
 * This test fails when a NEW talent-gated route is added without rep coverage and
 * without a whitelist entry — flagging the parity gap at PR time.
 *
 * To resolve a failure: either add rep delegation to the route, or (if the action
 * is legitimately talent-only) add it to TALENT_ONLY_WHITELIST with a reason.
 */

// Routes that are legitimately talent-personal (a rep can't/shouldn't do them on
// the talent's behalf). Key = path relative to app/api, value = reason.
const TALENT_ONLY_WHITELIST: Record<string, string> = {
  "settings/pitch-vignettes/route.ts": "personal account toggle for the talent's own AI pitch vignettes",
  "settings/vault-lock/route.ts": "personal security control — only the talent locks their own vault",
  "bookings/route.ts": "talent books their own scan capture session",
  "cast/claimable/route.ts": "talent claims production-held vaults for their own identity",
  "compliance/evidence/route.ts": "talent's own compliance evidence view",
  "licences/[id]/preauth/confirm/route.ts": "talent personally confirms a download pre-authorisation",
  "licences/[id]/preauth/set/route.ts": "talent personally sets a download pre-authorisation window",
  "productions/[id]/cast/[castId]/claim/route.ts": "talent claims their own reserved cast slot (identity action)",
  "onboarding/confirm/route.ts": "talent's own onboarding/profile confirmation",
  "onboarding/search/route.ts": "talent's own onboarding identity search",
  "onboarding/union-affiliation/route.ts": "talent's own onboarding union affiliation",
  "vault/packages/search/route.ts": "talent searches their own scan packages",
  "cast/dismiss/route.ts": "talent personally dismisses a 'Not me' cast-claim suggestion for their own identity",
};

const API_DIR = join(process.cwd(), "app", "api");

// A route is "talent-gated" if it restricts/allows the talent role explicitly.
const TALENT_GATE = /===\s*"talent"|!==\s*"talent"|role:\s*"talent"/;
// A route "covers reps" if it references rep-role handling or the delegation helpers.
const REP_COVERAGE = /"rep"|hasRepAccess|talentReps|getRepAgencyContext/;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("talent ↔ rep authorisation parity", () => {
  const files = routeFiles(API_DIR);

  it("finds API route files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every talent-gated route either covers reps or is whitelisted as talent-only", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = file.slice(API_DIR.length + 1).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (!TALENT_GATE.test(src)) continue; // not talent-gated
      if (REP_COVERAGE.test(src)) continue; // already accommodates reps
      if (rel in TALENT_ONLY_WHITELIST) continue; // explicitly talent-only
      violations.push(rel);
    }
    expect(
      violations,
      `These routes gate on the talent role but have no rep delegation and are not whitelisted.\n` +
        `Either add rep coverage (role === "rep" + hasRepAccess/talentReps) or add the route to ` +
        `TALENT_ONLY_WHITELIST with a reason in __tests__/parity/talent-rep-parity.test.ts:\n  - ` +
        violations.join("\n  - "),
    ).toEqual([]);
  });

  it("whitelist has no stale entries (every whitelisted path still exists and is still talent-only without rep coverage)", () => {
    const stale: string[] = [];
    for (const rel of Object.keys(TALENT_ONLY_WHITELIST)) {
      const full = join(API_DIR, rel);
      let src: string;
      try { src = readFileSync(full, "utf8"); } catch { stale.push(`${rel} (file no longer exists)`); continue; }
      if (!TALENT_GATE.test(src)) stale.push(`${rel} (no longer talent-gated — remove from whitelist)`);
      else if (REP_COVERAGE.test(src)) stale.push(`${rel} (now covers reps — remove from whitelist)`);
    }
    expect(stale, `Stale whitelist entries in talent-rep-parity.test.ts:\n  - ${stale.join("\n  - ")}`).toEqual([]);
  });
});
