import { describe, it, expect } from "vitest";
import { parseMemberNames } from "@/lib/compliance/members";

describe("parseMemberNames", () => {
  it("splits on commas and new lines", () => {
    expect(parseMemberNames("Jane Doe, John Smith\nAlex Rivera")).toEqual(["Jane Doe", "John Smith", "Alex Rivera"]);
  });

  it("trims, collapses inner whitespace, and drops blanks", () => {
    expect(parseMemberNames("  Jane   Doe ,, ,\n\n  John  Smith  ")).toEqual(["Jane Doe", "John Smith"]);
  });

  it("de-duplicates case/punctuation-insensitively within the batch", () => {
    expect(parseMemberNames("Jane Doe, jane doe, JANE  DOE")).toEqual(["Jane Doe"]);
  });

  it("returns an empty array for an empty / separator-only blob", () => {
    expect(parseMemberNames("  , ,\n , ")).toEqual([]);
  });
});
