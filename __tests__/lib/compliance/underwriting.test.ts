import { describe, it, expect } from "vitest";
import { gradeFor, GRADE_LABEL, POLICY_LINES } from "@/lib/compliance/underwriting";

describe("gradeFor", () => {
  it("maps a clean, high-health production to A", () => {
    expect(gradeFor({ healthScore: 95, useViolations: 0, activeStrikes: 0 })).toBe("A");
    expect(gradeFor({ healthScore: 85, useViolations: 0, activeStrikes: 0 })).toBe("A");
  });

  it("tracks the compliance health band when there are no hard breaches", () => {
    expect(gradeFor({ healthScore: 84, useViolations: 0, activeStrikes: 0 })).toBe("B");
    expect(gradeFor({ healthScore: 70, useViolations: 0, activeStrikes: 0 })).toBe("B");
    expect(gradeFor({ healthScore: 69, useViolations: 0, activeStrikes: 0 })).toBe("C");
    expect(gradeFor({ healthScore: 55, useViolations: 0, activeStrikes: 0 })).toBe("C");
    expect(gradeFor({ healthScore: 54, useViolations: 0, activeStrikes: 0 })).toBe("D");
  });

  it("caps the grade at C for a single use violation even with perfect health", () => {
    expect(gradeFor({ healthScore: 100, useViolations: 1, activeStrikes: 0 })).toBe("C");
  });

  it("caps the grade at C for an active strike even with perfect health", () => {
    expect(gradeFor({ healthScore: 100, useViolations: 0, activeStrikes: 1 })).toBe("C");
  });

  it("drops to D when use violations span more than one licence", () => {
    expect(gradeFor({ healthScore: 100, useViolations: 2, activeStrikes: 0 })).toBe("D");
  });

  it("exposes a label for every grade", () => {
    for (const g of ["A", "B", "C", "D"] as const) {
      expect(GRADE_LABEL[g]).toBeTruthy();
    }
  });

  it("only recognises the four insurer policy lines", () => {
    expect([...POLICY_LINES].sort()).toEqual(["completion_bond", "cyber", "eo", "other"]);
  });
});
