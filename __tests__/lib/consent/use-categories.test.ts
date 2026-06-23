import { describe, it, expect } from "vitest";
import {
  USE_CATEGORIES,
  TRAINING_USE_CATEGORY_ID,
  listUseCategories,
  getUseCategory,
  isUseCategoryId,
  normaliseUseCategoryIds,
  serializeUseCategoryIds,
  parseUseCategoryIds,
  reconcileTrainingFlag,
} from "@/lib/consent/use-categories";

describe("use-category taxonomy", () => {
  it("defines the six prototype categories with stable ids", () => {
    expect(USE_CATEGORIES.map((c) => c.id)).toEqual([
      "vfx-this",
      "reuse",
      "dub",
      "replica",
      "training",
      "marketing",
    ]);
  });

  it("tags sensitive categories and their legal regime sections", () => {
    expect(getUseCategory("replica")).toMatchObject({ regimeTag: "§39E", sensitive: true });
    expect(getUseCategory("training")).toMatchObject({ regimeTag: "§39G", sensitive: true });
    expect(getUseCategory("dub")).toMatchObject({ regimeTag: "§39D", sensitive: false });
    expect(getUseCategory("vfx-this")).toMatchObject({ regimeTag: null, sensitive: false });
  });

  it("listUseCategories returns every category", () => {
    expect(listUseCategories()).toHaveLength(6);
  });
});

describe("isUseCategoryId", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isUseCategoryId("training")).toBe(true);
    expect(isUseCategoryId("nope")).toBe(false);
    expect(isUseCategoryId(undefined)).toBe(false);
    expect(isUseCategoryId(42)).toBe(false);
  });
});

describe("normaliseUseCategoryIds", () => {
  it("drops unknown ids, de-duplicates, and restores canonical order", () => {
    expect(normaliseUseCategoryIds(["dub", "vfx-this", "dub", "garbage"])).toEqual(["vfx-this", "dub"]);
  });

  it("returns [] for non-array input", () => {
    expect(normaliseUseCategoryIds(null)).toEqual([]);
    expect(normaliseUseCategoryIds("training")).toEqual([]);
  });
});

describe("serialize / parse round-trip", () => {
  it("serializes to a JSON array and parses back", () => {
    const json = serializeUseCategoryIds(["marketing", "vfx-this"]);
    expect(json).toBe(JSON.stringify(["vfx-this", "marketing"]));
    expect(parseUseCategoryIds(json)).toEqual(["vfx-this", "marketing"]);
  });

  it("serializes empty/invalid to null and parses null to []", () => {
    expect(serializeUseCategoryIds([])).toBeNull();
    expect(serializeUseCategoryIds(["garbage"])).toBeNull();
    expect(parseUseCategoryIds(null)).toEqual([]);
    expect(parseUseCategoryIds("not json")).toEqual([]);
  });
});

describe("reconcileTrainingFlag", () => {
  it("permitAiTraining=true forces the training category in", () => {
    const r = reconcileTrainingFlag({ useCategoryIds: ["dub"], permitAiTraining: true });
    expect(r.permitAiTraining).toBe(true);
    expect(r.useCategoryIds).toEqual(["dub", TRAINING_USE_CATEGORY_ID]);
  });

  it("selecting the training category forces permitAiTraining true", () => {
    const r = reconcileTrainingFlag({ useCategoryIds: ["training"], permitAiTraining: false });
    expect(r.permitAiTraining).toBe(true);
    expect(r.useCategoryIds).toEqual(["training"]);
  });

  it("leaves a non-training selection with the flag off untouched", () => {
    const r = reconcileTrainingFlag({ useCategoryIds: ["vfx-this", "marketing"], permitAiTraining: false });
    expect(r.permitAiTraining).toBe(false);
    expect(r.useCategoryIds).toEqual(["vfx-this", "marketing"]);
  });

  it("handles empty/missing input", () => {
    expect(reconcileTrainingFlag({})).toEqual({ useCategoryIds: [], permitAiTraining: false });
  });
});
