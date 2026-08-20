import { describe, it, expect } from "vitest";

import { MONITOR_PLATFORMS } from "@/lib/monitor/platforms";
import type { TalentIdentityAnchor } from "@/lib/monitor/types";
import { buildDiscoveryPlan } from "@/lib/monitor/ingest/queries";
import { buildTikTokQueries } from "@/lib/monitor/ingest/tiktok";
import { buildYouTubeQueries } from "@/lib/monitor/ingest/youtube";
import { buildXQueries } from "@/lib/monitor/ingest/x";
import { buildPinterestQueries } from "@/lib/monitor/ingest/pinterest";
import { buildSerpQueries } from "@/lib/monitor/ingest/serp";
import {
  CONFIRMING_HIT_STATUSES,
  isConfirmingHitStatus,
} from "@/lib/monitor/query-mining";

const HARDY: TalentIdentityAnchor = {
  fullName: "Tom Hardy",
  knownForTitles: ["Venom", "Mad Max"],
  scanPackageCount: 1,
  geometryFingerprintCount: 0,
};

/** A mined tag no hardcoded vocabulary could contain — the fake role name. */
const LEARNED = ["tomhardyrayleigh"];

/**
 * Every platform's query builder, invoked the way scan.ts invokes it, with a
 * learned vocabulary attached. Keyed by MonitorPlatformId so the drift guard
 * below can hold this map against the platform registry.
 */
const LEARNED_CONSUMERS: Record<string, (learned: string[]) => string[]> = {
  instagram: (learned) =>
    buildDiscoveryPlan(HARDY, { learnedHashtags: learned }).map((q) => q.value),
  tiktok: (learned) => buildTikTokQueries(HARDY, 4, learned),
  youtube: (learned) => buildYouTubeQueries(HARDY, 5, learned),
  x: (learned) => buildXQueries(HARDY, 3, learned),
  pinterest: (learned) => buildPinterestQueries(HARDY, 3, learned),
  google: (learned) => buildSerpQueries("google", HARDY, learned),
  getty: (learned) => buildSerpQueries("getty", HARDY, learned),
};

/**
 * Platforms that legitimately cannot consume learned hashtags, with the
 * reason. A platform belongs here only while the reason is true.
 */
const NO_QUERY_DISCOVERY: Record<string, string> = {
  reddit: "no dedicated ingest module — the registry entry has no live query builder to wire",
  midjourney: "Civitai model registry is searched by talent name; hashtags are not a query primitive there",
};

describe("learned-query wiring — drift guard", () => {
  // The test that failed to exist when TikTok was the only consumer: every
  // platform in the registry must either consume the learned vocabulary or
  // carry an explicit reason it can't. Adding a platform without deciding
  // fails here, which is the point.
  it("every registry platform either consumes learned queries or documents why not", () => {
    for (const platform of MONITOR_PLATFORMS) {
      const consumes = platform.id in LEARNED_CONSUMERS;
      const excused = platform.id in NO_QUERY_DISCOVERY;
      expect(
        consumes || excused,
        `Platform "${platform.id}" is in MONITOR_PLATFORMS but neither consumes learned queries ` +
          `nor documents why it can't. Wire its query builder to learnedHashtags (and add it to ` +
          `LEARNED_CONSUMERS here), or add it to NO_QUERY_DISCOVERY with the reason.`
      ).toBe(true);
      expect(
        consumes && excused,
        `Platform "${platform.id}" is in both LEARNED_CONSUMERS and NO_QUERY_DISCOVERY — pick one.`
      ).toBe(false);
    }
  });

  it("covers no platforms that aren't in the registry", () => {
    const known = new Set(MONITOR_PLATFORMS.map((p) => p.id as string));
    for (const id of [...Object.keys(LEARNED_CONSUMERS), ...Object.keys(NO_QUERY_DISCOVERY)]) {
      expect(known.has(id), `"${id}" is not a registry platform`).toBe(true);
    }
  });

  it("each consumer's built queries actually carry the learned tag", () => {
    for (const [id, build] of Object.entries(LEARNED_CONSUMERS)) {
      const queries = build(LEARNED);
      expect(
        queries.some((q) => q.toLowerCase().includes(LEARNED[0])),
        `${id}: learned tag missing from built queries: ${JSON.stringify(queries)}`
      ).toBe(true);
    }
  });

  it("learned tags expand the query set, never displace the standing vocabulary", () => {
    for (const [id, build] of Object.entries(LEARNED_CONSUMERS)) {
      const without = build([]);
      const withLearned = new Set(build(LEARNED));
      for (const q of without) {
        expect(withLearned.has(q), `${id}: learned tags displaced standing query "${q}"`).toBe(true);
      }
    }
  });

  it("a '#'-prefixed mined tag is normalised, not doubled", () => {
    for (const [id, build] of Object.entries(LEARNED_CONSUMERS)) {
      const queries = build(["#tomhardyrayleigh"]);
      expect(
        queries.some((q) => q.includes("##")),
        `${id}: double-hash in ${JSON.stringify(queries)}`
      ).toBe(false);
      expect(queries.some((q) => q.toLowerCase().includes("tomhardyrayleigh"))).toBe(true);
    }
  });
});

describe("mining gate — human confirmation only", () => {
  it("confirm, takedown request and resolve all count as confirmation", () => {
    expect([...CONFIRMING_HIT_STATUSES].sort()).toEqual(
      ["confirmed", "resolved", "takedown_requested"]
    );
  });

  it("machine-flagged and dismissed hits never feed the vocabulary", () => {
    expect(isConfirmingHitStatus("new")).toBe(false);
    expect(isConfirmingHitStatus("dismissed")).toBe(false);
    expect(isConfirmingHitStatus(null)).toBe(false);
    expect(isConfirmingHitStatus(undefined)).toBe(false);
  });

  it("requesting a takedown is an instant confirm", () => {
    expect(isConfirmingHitStatus("takedown_requested")).toBe(true);
  });
});
