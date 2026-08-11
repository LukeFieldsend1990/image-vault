#!/usr/bin/env node
/**
 * Discovery bake-off — measure which surface actually finds synthetic content.
 *
 * Standing question after the first live checks: Instagram hashtags produced
 * nothing under #tomhardyai, Apify cannot reach Instagram's free-text search,
 * and the two real examples we have were found by a human typing "tom hardy ai"
 * into the app. So which programmatic surface gets closest to that?
 *
 * Runs each available source at small limits, then scores by what matters:
 * how many results plausibly relate to the talent AND read as synthetic.
 *
 * Usage:
 *   node scripts/discovery-bakeoff.mjs                 # Tom Hardy
 *   node scripts/discovery-bakeoff.mjs "Margot Robbie" 10
 *
 * Needs APIFY_TOKEN for the Instagram/TikTok rows and YOUTUBE_API_KEY for the
 * YouTube row; missing keys skip their rows rather than failing.
 */

import { readFileSync } from "node:fs";

const APIFY_BASE = "https://api.apify.com/v2";

function readEnv(key) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  for (const file of [".env.local", ".dev.vars"]) {
    try {
      const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .find((l) => l.trim().startsWith(`${key}=`));
      const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    } catch {
      /* next */
    }
  }
  return null;
}

const apifyToken = readEnv("APIFY_TOKEN");
const ytKey = readEnv("YOUTUBE_API_KEY");
const name = process.argv[2] ?? "Tom Hardy";
const limit = Number(process.argv[3] ?? 10);
const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameLower = name.toLowerCase();

// Same vocabulary the pre-filter uses, so the score reflects what would survive.
const AI_WORDS =
  /(^|[^a-z0-9])(ai|deepfake|deep fake|faceswap|face swap|synthetic|generated|midjourney|sora|veo|runway|concept trailer|fan made|fanmade|fan trailer|what if|reimagined|recast|unofficial)([^a-z0-9]|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function score(rows) {
  const named = rows.filter((r) => (r.text ?? "").toLowerCase().includes(nameLower));
  const synthetic = named.filter((r) => AI_WORDS.test(r.text ?? ""));
  return { total: rows.length, named: named.length, synthetic: synthetic.length, examples: synthetic.slice(0, 3) };
}

async function apifyRun(actor, input) {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actor}/runs?token=${encodeURIComponent(apifyToken)}&maxItems=${limit}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data } = await res.json();
  let status = data.status;
  const deadline = Date.now() + 180_000;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) throw new Error("timeout");
    await sleep(4000);
    process.stdout.write(".");
    const poll = await fetch(`${APIFY_BASE}/actor-runs/${data.id}?token=${encodeURIComponent(apifyToken)}`);
    status = (await poll.json()).data.status;
  }
  if (status !== "SUCCEEDED") throw new Error(status);
  const items = await (
    await fetch(
      `${APIFY_BASE}/datasets/${data.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(apifyToken)}`
    )
  ).json();
  return items.filter((i) => i && !i.error);
}

const SOURCES = [
  {
    label: `IG hashtag #${slug} (bare name)`,
    enabled: () => !!apifyToken,
    run: async () => {
      const items = await apifyRun("apify~instagram-hashtag-scraper", {
        hashtags: [slug],
        resultsLimit: limit,
      });
      return items.map((i) => ({ text: `${i.caption ?? ""} ${(i.hashtags ?? []).join(" ")}`, url: i.url }));
    },
  },
  {
    label: `IG hashtag #${slug}ai`,
    enabled: () => !!apifyToken,
    run: async () => {
      const items = await apifyRun("apify~instagram-hashtag-scraper", {
        hashtags: [`${slug}ai`],
        resultsLimit: limit,
      });
      return items.map((i) => ({ text: `${i.caption ?? ""} ${(i.hashtags ?? []).join(" ")}`, url: i.url }));
    },
  },
  {
    label: `TikTok keyword "${name} ai"`,
    enabled: () => !!apifyToken,
    run: async () => {
      const items = await apifyRun("clockworks~tiktok-scraper", {
        searchQueries: [`${name} ai`],
        resultsPerPage: limit,
        shouldDownloadVideos: false,
      });
      return items.map((i) => ({ text: i.text ?? "", url: i.webVideoUrl }));
    },
  },
  {
    label: `YouTube search "${name} ai trailer"`,
    enabled: () => !!ytKey,
    run: async () => {
      const params = new URLSearchParams({
        key: ytKey,
        part: "snippet",
        type: "video",
        q: `${name} ai trailer`,
        maxResults: String(limit),
      });
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return (body.items ?? []).map((i) => ({
        text: `${i.snippet?.title ?? ""} ${i.snippet?.description ?? ""}`,
        url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
      }));
    },
  },
];

console.log(`\nDiscovery bake-off — "${name}", ${limit} results per source`);
console.log("═".repeat(66));

const results = [];
for (const source of SOURCES) {
  if (!source.enabled()) {
    console.log(`\n▸ ${source.label}\n  SKIPPED (no key)`);
    continue;
  }
  process.stdout.write(`\n▸ ${source.label}\n  `);
  try {
    const rows = await source.run();
    const s = score(rows);
    results.push({ label: source.label, ...s });
    console.log(`\n  ${s.total} result(s) · ${s.named} mention the name · ${s.synthetic} read as synthetic`);
    for (const ex of s.examples) {
      console.log(`    · ${(ex.text ?? "").replace(/\s+/g, " ").slice(0, 88)}…`);
      console.log(`      ${ex.url}`);
    }
  } catch (err) {
    console.log(`\n  FAILED: ${err.message}`);
    results.push({ label: source.label, total: 0, named: 0, synthetic: 0 });
  }
}

console.log(`\n${"═".repeat(66)}`);
console.log("YIELD (synthetic hits per source — this is the number that matters)\n");
for (const r of [...results].sort((a, b) => b.synthetic - a.synthetic)) {
  const bar = "█".repeat(Math.min(30, r.synthetic * 3)) || "·";
  console.log(`  ${String(r.synthetic).padStart(3)}  ${bar}  ${r.label}`);
}
console.log("\nA source finding nothing here is a source not worth its query budget.");
