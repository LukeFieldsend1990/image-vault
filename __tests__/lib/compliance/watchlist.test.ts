import { describe, it, expect } from "vitest";
import { normaliseName } from "@/lib/compliance/watchlist";

describe("normaliseName (watchlist ratification matcher)", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(normaliseName("Avatar 4")).toBe(normaliseName("  avatar   4 "));
  });

  it("ignores punctuation so 'Spider-Man' matches 'Spider Man'", () => {
    expect(normaliseName("Spider-Man: Beyond")).toBe(normaliseName("Spider Man Beyond"));
  });

  it("collapses runs of separators to a single space", () => {
    expect(normaliseName("The   Batman!!!")).toBe("the batman");
  });

  it("does not conflate genuinely different titles", () => {
    expect(normaliseName("Dune")).not.toBe(normaliseName("Dune Part Two"));
  });
});
