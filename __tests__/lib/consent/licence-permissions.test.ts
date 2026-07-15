import { describe, it, expect } from "vitest";
import {
  LICENCE_TYPES,
  LICENCE_TYPE_USE_CATEGORY,
  PERMISSION_DEFAULTS,
  isLicenceType,
  isLicencePermission,
  dispositionToPermission,
  permissionToDisposition,
  resolveLicencePermissions,
} from "@/lib/consent/licence-permissions";
import { isUseCategoryId } from "@/lib/consent/use-categories";

describe("licence-type model", () => {
  it("defines the six licence types with stable ids", () => {
    expect([...LICENCE_TYPES]).toEqual([
      "commercial",
      "film_double",
      "game_character",
      "ai_avatar",
      "training_data",
      "monitoring_reference",
    ]);
  });

  it("maps overlapping licence types onto valid use categories", () => {
    expect(LICENCE_TYPE_USE_CATEGORY.training_data).toBe("training");
    for (const [type, categoryId] of Object.entries(LICENCE_TYPE_USE_CATEGORY)) {
      expect(isLicenceType(type)).toBe(true);
      expect(isUseCategoryId(categoryId)).toBe(true);
    }
  });

  it("guards accept known values and reject everything else", () => {
    expect(isLicenceType("commercial")).toBe(true);
    expect(isLicenceType("training")).toBe(false);
    expect(isLicenceType(undefined)).toBe(false);
    expect(isLicencePermission("blocked")).toBe(true);
    expect(isLicencePermission("never")).toBe(false);
  });
});

describe("disposition ↔ permission mapping", () => {
  it("is a bijection over the three states", () => {
    expect(dispositionToPermission("always")).toBe("allowed");
    expect(dispositionToPermission("case_by_case")).toBe("approval_required");
    expect(dispositionToPermission("never")).toBe("blocked");
    for (const d of ["always", "case_by_case", "never"] as const) {
      expect(permissionToDisposition(dispositionToPermission(d))).toBe(d);
    }
  });
});

describe("resolveLicencePermissions", () => {
  it("falls back to defaults when nothing is stored", () => {
    const resolved = resolveLicencePermissions([], {});
    expect(resolved).toHaveLength(LICENCE_TYPES.length);
    for (const { licenceType, permission } of resolved) {
      expect(permission).toBe(PERMISSION_DEFAULTS[licenceType]);
    }
  });

  it("uses stored rows for licence types with no consent counterpart", () => {
    const resolved = resolveLicencePermissions(
      [{ licenceType: "commercial", permission: "blocked" }],
      {},
    );
    expect(resolved.find((p) => p.licenceType === "commercial")?.permission).toBe("blocked");
  });

  it("derives consent-owned types from the standing instruction, overriding stored rows", () => {
    const resolved = resolveLicencePermissions(
      [{ licenceType: "training_data", permission: "allowed" }],
      { training: "never" },
    );
    expect(resolved.find((p) => p.licenceType === "training_data")?.permission).toBe("blocked");
  });

  it("keeps a pre-existing stored row when the instruction is unset", () => {
    const resolved = resolveLicencePermissions(
      [{ licenceType: "training_data", permission: "approval_required" }],
      {},
    );
    expect(resolved.find((p) => p.licenceType === "training_data")?.permission).toBe("approval_required");
  });

  it("maps each disposition onto the licence state", () => {
    for (const [disposition, permission] of [
      ["always", "allowed"],
      ["case_by_case", "approval_required"],
      ["never", "blocked"],
    ] as const) {
      const resolved = resolveLicencePermissions([], { training: disposition });
      expect(resolved.find((p) => p.licenceType === "training_data")?.permission).toBe(permission);
    }
  });
});
