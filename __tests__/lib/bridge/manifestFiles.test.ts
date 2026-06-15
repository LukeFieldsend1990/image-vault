import { describe, it, expect } from "vitest";
import { dedupeFilesByPath } from "@/lib/bridge/manifestFiles";

describe("dedupeFilesByPath", () => {
  it("returns the input unchanged when all filenames are unique", () => {
    const files = [
      { id: "a", filename: "GS01.ARW", completedAt: 10, createdAt: 1 },
      { id: "b", filename: "AS01.ARW", completedAt: 11, createdAt: 2 },
    ];
    expect(dedupeFilesByPath(files)).toEqual(files);
  });

  it("collapses duplicate filenames to the most recently completed row", () => {
    const older = { id: "a", filename: "GS01.ARW", completedAt: 100, createdAt: 1 };
    const newer = { id: "b", filename: "GS01.ARW", completedAt: 200, createdAt: 2 };
    const result = dedupeFilesByPath([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(newer);
  });

  it("collapses three same-named rows (the CSV mass-FP shape) to one", () => {
    const rows = [
      { id: "a", filename: "GS01.ARW", completedAt: 100, createdAt: 1 },
      { id: "b", filename: "GS01.ARW", completedAt: 150, createdAt: 2 },
      { id: "c", filename: "GS01.ARW", completedAt: 120, createdAt: 3 },
    ];
    const result = dedupeFilesByPath(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b"); // highest completedAt
  });

  it("falls back to createdAt when completedAt ties, then to id", () => {
    const rows = [
      { id: "a", filename: "X.ARW", completedAt: 0, createdAt: 5 },
      { id: "b", filename: "X.ARW", completedAt: 0, createdAt: 9 },
      { id: "c", filename: "X.ARW", completedAt: 0, createdAt: 9 },
    ];
    const result = dedupeFilesByPath(rows);
    expect(result).toHaveLength(1);
    // createdAt ties between b and c at 9 → deterministic id tiebreak picks "c"
    expect(result[0].id).toBe("c");
  });

  it("handles null/undefined timestamps without throwing", () => {
    const rows = [
      { id: "a", filename: "Y.ARW", completedAt: null, createdAt: null },
      { id: "b", filename: "Y.ARW", completedAt: 5, createdAt: 1 },
    ];
    const result = dedupeFilesByPath(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("preserves the original order of surviving rows", () => {
    const rows = [
      { id: "1", filename: "A.ARW", completedAt: 10, createdAt: 1 },
      { id: "2", filename: "B.ARW", completedAt: 10, createdAt: 1 },
      { id: "3", filename: "A.ARW", completedAt: 20, createdAt: 1 },
    ];
    const result = dedupeFilesByPath(rows);
    expect(result.map((f) => f.filename)).toEqual(["B.ARW", "A.ARW"]);
  });
});
