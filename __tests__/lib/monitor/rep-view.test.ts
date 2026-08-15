import { describe, it, expect } from "vitest";

import { filterSecondaryActorsForRoster } from "@/lib/monitor/rep-view";

const actor = (overrides: Partial<{ talentId: string | null; name: string; onboarded?: boolean }> = {}) => ({
  talentId: null as string | null,
  name: "Some Actor",
  profileImageUrl: null as string | null,
  confidence: 80 as number | null,
  source: "vision_caption",
  onboarded: false as boolean | undefined,
  ...overrides,
});

describe("filterSecondaryActorsForRoster", () => {
  const rosterIds = new Set(["talent-a", "talent-b"]);

  it("passes roster members through whole", () => {
    const hits = [
      { id: "h1", secondaryActors: [actor({ talentId: "talent-a", name: "Client A", onboarded: true })] },
    ];
    const [hit] = filterSecondaryActorsForRoster(hits, rosterIds);
    expect(hit.secondaryActors[0].talentId).toBe("talent-a");
    expect(hit.secondaryActors[0].onboarded).toBe(true);
  });

  it("strips membership from onboarded non-roster talent but keeps public identity", () => {
    const hits = [
      {
        id: "h1",
        secondaryActors: [actor({ talentId: "talent-z", name: "Other Talent", onboarded: true })],
      },
    ];
    const [hit] = filterSecondaryActorsForRoster(hits, rosterIds);
    // Platform membership of non-roster talent is not the rep's to see.
    expect(hit.secondaryActors[0].talentId).toBeNull();
    expect(hit.secondaryActors[0].onboarded).toBeUndefined();
    // Public name/photo survive — that's TMDB-grade information.
    expect(hit.secondaryActors[0].name).toBe("Other Talent");
  });

  it("leaves non-onboarded (TMDB-only) actors untouched", () => {
    const hits = [{ id: "h1", secondaryActors: [actor({ talentId: null, name: "Public Actor" })] }];
    const [hit] = filterSecondaryActorsForRoster(hits, rosterIds);
    expect(hit.secondaryActors[0]).toEqual(actor({ talentId: null, name: "Public Actor" }));
  });

  it("does not mutate the input", () => {
    const hits = [
      { id: "h1", secondaryActors: [actor({ talentId: "talent-z", name: "Other", onboarded: true })] },
    ];
    filterSecondaryActorsForRoster(hits, rosterIds);
    expect(hits[0].secondaryActors[0].talentId).toBe("talent-z");
    expect(hits[0].secondaryActors[0].onboarded).toBe(true);
  });
});
