import { describe, it, expect } from "vitest";

import {
  characterAliases,
  compoundAliases,
  describeVigilance,
  identityTermMatch,
  parseCastAnnouncement,
  productionAliases,
  surgeIntervalSeconds,
  vigilanceHashtags,
  vigilanceMatch,
  vigilancePhrases,
  vigilancePhase,
  PEAK_DAYS,
} from "@/lib/monitor/vigilance";
import { buildDiscoveryPlan } from "@/lib/monitor/ingest/queries";
import { buildTikTokQueries } from "@/lib/monitor/ingest/tiktok";
import { preFilter } from "@/lib/monitor/ingest/instagram";
import type { CandidateContent, TalentIdentityAnchor, VigilanceAnchor } from "@/lib/monitor/types";

const DAY = 86_400;
const NOW = 1_786_795_200; // announcement day

function anchorFor(vigilance?: VigilanceAnchor | null): TalentIdentityAnchor {
  return {
    fullName: "Kit Connor",
    knownForTitles: ["Heartstopper"],
    scanPackageCount: 2,
    geometryFingerprintCount: 0,
    vigilance: vigilance ?? null,
  };
}

function xmenWindow(over: Partial<VigilanceAnchor> = {}): VigilanceAnchor {
  const characters = characterAliases("Scott Summers/Cyclops");
  return {
    eventId: "evt-1",
    eventTitle: "X-Men cast announcement",
    kind: "cast_announcement",
    productionTitle: "X-Men",
    announcedAt: NOW,
    daysSinceAnnouncement: 2,
    phase: "peak",
    characterAliases: characters,
    productionAliases: productionAliases("X-Men"),
    compoundAliases: compoundAliases("Kit Connor", characters),
    extraHashtags: vigilanceHashtags(
      { personName: "Kit Connor", characters, productions: productionAliases("X-Men") },
      "peak"
    ),
    ...over,
  };
}

function candidate(over: Partial<CandidateContent> = {}): CandidateContent {
  return {
    platform: "instagram",
    contentType: "reel",
    contentUrl: "https://instagram.com/p/" + Math.random().toString(36).slice(2),
    authorHandle: "@ai_trailers",
    caption: "",
    hashtags: [],
    signals: {
      faceEmbeddingSimilarity: null,
      perceptualHashDistance: null,
      geometryFingerprintCorrelation: null,
      syntheticMediaScore: null,
      postedDaysAgo: 1,
      viewCount: 1000,
    },
    ...over,
  };
}

describe("parsing a pasted cast announcement", () => {
  it("reads the bullet-separated form the trades actually publish", () => {
    const parsed = parseCastAnnouncement(
      "Kit Connor as Scott Summers/Cyclops •Sadie Sink as Jean Grey\n" +
        "Christopher Abbott as Professor Charles Xavier Inde Navarrette as Anna Marie/Rogue"
    );
    expect(parsed.map((p) => p.personName)).toContain("Kit Connor");
    expect(parsed.map((p) => p.personName)).toContain("Sadie Sink");
    expect(parsed.find((p) => p.personName === "Kit Connor")?.characterName).toBe(
      "Scott Summers/Cyclops"
    );
  });

  it("survives a run-on paste with missing bullets", () => {
    // Verbatim shape of a real announcement copied out of a post: bullets on
    // some breaks, none on others, so two personas share a line.
    const parsed = parseCastAnnouncement(
      "Kit Connor as Scott Summers/Cyclops •Sadie Sink as Jean Grey " +
        "•Christopher Abbott as Professor Charles Xavier Inde Navarrette as Anna Marie/Rogue " +
        "Maya Boyd as Ororo Munroe/Storm\n" +
        "Samara Weaving as Emma Frost Adam Driver as Nathaniel Milbury/Mr. Sinister"
    );
    expect(parsed).toHaveLength(7);
    expect(parsed.find((p) => p.personName === "Christopher Abbott")?.characterName).toBe(
      "Professor Charles Xavier"
    );
    expect(parsed.find((p) => p.personName === "Adam Driver")?.characterName).toBe(
      "Nathaniel Milbury/Mr. Sinister"
    );
  });

  it("keeps a persona named without a role", () => {
    const parsed = parseCastAnnouncement("Samara Weaving\nAdam Driver");
    expect(parsed).toHaveLength(2);
    expect(parsed[0].characterName).toBeNull();
  });

  it("drops single-word fragments rather than inventing personas from prose", () => {
    expect(parseCastAnnouncement("Marvel\nannounced\ntoday")).toHaveLength(0);
  });

  it("does not duplicate a person named twice", () => {
    const parsed = parseCastAnnouncement("Kit Connor as Cyclops\nKit Connor as Scott Summers");
    expect(parsed).toHaveLength(1);
  });
});

describe("persona vocabulary", () => {
  it("splits a slashed role into both names people tag", () => {
    const aliases = characterAliases("Scott Summers/Cyclops");
    expect(aliases).toContain("scott summers");
    expect(aliases).toContain("cyclops");
    expect(aliases).toContain("scottsummers");
  });

  it("carries the hyphen-stripped spelling of a production", () => {
    expect(productionAliases("X-Men")).toContain("xmen");
  });

  it("fuses actor and role into a self-identifying tag", () => {
    expect(compoundAliases("Kit Connor", ["cyclops"])).toContain("kitconnorcyclops");
  });

  it("ranks compound tags ahead of production tags under the cap", () => {
    const tags = vigilanceHashtags(
      {
        personName: "Kit Connor",
        characters: characterAliases("Scott Summers/Cyclops"),
        productions: productionAliases("X-Men"),
      },
      "peak"
    );
    expect(tags[0].startsWith("kitconnor")).toBe(true);
    expect(tags).toContain("kitconnorcyclops");
    expect(tags.indexOf("kitconnorcyclops")).toBeLessThan(tags.indexOf("xmenai"));
    expect(tags.length).toBeLessThanOrEqual(6);
  });

  it("spends fewer queries once the wave is past peak", () => {
    const args = {
      personName: "Kit Connor",
      characters: characterAliases("Scott Summers/Cyclops"),
      productions: productionAliases("X-Men"),
    };
    expect(vigilanceHashtags(args, "elevated").length).toBeLessThan(
      vigilanceHashtags(args, "peak").length
    );
  });

  it("builds free-text phrases for the surfaces that take them", () => {
    const phrases = vigilancePhrases("Kit Connor", xmenWindow(), 3);
    // The code name, not the civilian name — that is what the content is titled with.
    expect(phrases[0]).toBe("Kit Connor cyclops");
    expect(phrases.some((p) => p.includes("X-Men"))).toBe(true);
  });
});

describe("window decay", () => {
  it("is peak for the first fortnight, elevated after, and gone at expiry", () => {
    const expires = NOW + 60 * DAY;
    expect(vigilancePhase(NOW, expires, NOW + 3 * DAY)).toBe("peak");
    expect(vigilancePhase(NOW, expires, NOW + (PEAK_DAYS + 1) * DAY)).toBe("elevated");
    expect(vigilancePhase(NOW, expires, NOW + 61 * DAY)).toBeNull();
  });

  it("sweeps harder at peak than after it", () => {
    expect(surgeIntervalSeconds("peak")).toBeLessThan(surgeIntervalSeconds("elevated"));
  });
});

describe("persona matching", () => {
  const window = xmenWindow();

  it("accepts a compound tag on its own", () => {
    expect(vigilanceMatch("#kitconnorcyclops fan edit", window).matched).toBe(true);
  });

  it("accepts a character reference corroborated by the production", () => {
    const hit = vigilanceMatch("new cyclops for x-men, ai concept", window);
    expect(hit.matched).toBe(true);
    expect(hit.term).toContain("cyclops");
  });

  it("refuses a bare character word — this is the false-positive that matters", () => {
    // "Storm" and "Rogue" are ordinary English. A character alias alone can
    // never be an identity match, or a weather clip becomes a likeness hit.
    expect(vigilanceMatch("storm warning tonight", xmenWindow({
      characterAliases: characterAliases("Ororo Munroe/Storm"),
    })).matched).toBe(false);
    expect(vigilanceMatch("cyclops sunglasses restock", window).matched).toBe(false);
  });

  it("still matches the actor's own name with no window at all", () => {
    expect(identityTermMatch("kit connor at the premiere", "Kit Connor", null)).toBe(true);
    expect(identityTermMatch("cyclops x-men ai", "Kit Connor", null)).toBe(false);
  });
});

describe("discovery planning under a window", () => {
  it("puts the window's tags in front and does not displace the standing plan", () => {
    const base = buildDiscoveryPlan(anchorFor(), { maxQueries: 6 });
    const surged = buildDiscoveryPlan(anchorFor(xmenWindow()), { maxQueries: 6 });

    expect(surged[0].value.startsWith("kitconnor")).toBe(true);
    expect(surged.length).toBeGreaterThan(base.length);
    // Every query the ordinary plan would have run is still in the surged plan.
    for (const q of base) {
      expect(surged.some((s) => s.mode === q.mode && s.value === q.value)).toBe(true);
    }
  });

  it("never drops a watched offender account to make room", () => {
    const plan = buildDiscoveryPlan(anchorFor(xmenWindow()), {
      watchedHandles: ["ai_trailers", "deepfake_daily"],
      maxQueries: 4,
    });
    expect(plan.filter((q) => q.mode === "account")).toHaveLength(2);
  });

  it("adds announcement phrases to the TikTok keyword set", () => {
    const queries = buildTikTokQueries(anchorFor(xmenWindow()), 4);
    expect(queries[0]).toBe("Kit Connor cyclops");
    expect(queries).toContain("Kit Connor ai");
  });

  it("plans exactly as before when no window is open", () => {
    expect(buildDiscoveryPlan(anchorFor(), { maxQueries: 6 })).toEqual(
      buildDiscoveryPlan(
        {
          fullName: "Kit Connor",
          knownForTitles: ["Heartstopper"],
          scanPackageCount: 2,
          geometryFingerprintCount: 0,
        },
        { maxQueries: 6 }
      )
    );
  });
});

describe("pre-filter under a window", () => {
  const opts = (vigilance: VigilanceAnchor | null) => ({
    anchor: anchorFor(vigilance),
    scope: "ai_only" as const,
  });

  it("keeps a synthetic reel that names the role but not the actor", () => {
    const c = candidate({
      caption: "first look — cyclops in the new x-men. ai concept trailer",
      hashtags: ["cyclops", "xmen", "aivideo"],
    });
    expect(preFilter([c], opts(null)).kept).toHaveLength(0);

    const { kept } = preFilter([c], opts(xmenWindow()));
    expect(kept).toHaveLength(1);
    expect(kept[0].vigilanceMatchTerm).toBeTruthy();
  });

  it("does not stamp a vigilance term on a plain name match", () => {
    const c = candidate({ caption: "kit connor deepfake edit", hashtags: ["deepfake"] });
    const { kept } = preFilter([c], opts(xmenWindow()));
    expect(kept).toHaveLength(1);
    expect(kept[0].vigilanceMatchTerm).toBeUndefined();
  });

  it("keeps the AI-intent gate — a window widens identity, not scope", () => {
    // Press coverage of the announcement: role and production both present, no
    // synthetic claim anywhere. An ai_only monitor must still drop it.
    const c = candidate({
      authorHandle: "@screentrade",
      caption: "cyclops casting confirmed for x-men, red carpet interview",
      hashtags: ["cyclops", "xmen"],
    });
    const { kept, dropped } = preFilter([c], opts(xmenWindow()));
    expect(kept).toHaveLength(0);
    expect(dropped.no_ai_intent).toBe(1);
  });

  it("keeps honouring the allowlist inside a window", () => {
    const c = candidate({
      authorHandle: "@marvel",
      caption: "cyclops x-men ai concept",
      hashtags: ["cyclops", "xmen", "ai"],
    });
    const { kept, dropped } = preFilter([c], {
      ...opts(xmenWindow()),
      allowlist: ["marvel"],
    });
    expect(kept).toHaveLength(0);
    expect(dropped.allowlisted).toBe(1);
  });
});

describe("adjudicator briefing", () => {
  it("states the window and then states its limit", () => {
    const text = describeVigilance(xmenWindow());
    expect(text).toContain("X-Men cast announcement");
    expect(text).toMatch(/does NOT lower the evidence bar/i);
    expect(text).toMatch(/must NOT be flagged/i);
  });
});
