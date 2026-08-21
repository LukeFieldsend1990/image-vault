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
 * Actor bake-off — compare candidate (cheaper) actors against the incumbents
 * on the same queries before promoting one via /admin/monitor:
 *   node scripts/discovery-bakeoff.mjs "Tom Hardy" 10 \
 *     --ig-hashtag-actor=somevendor~instagram-hashtag-cheap \
 *     --tiktok-actor=somevendor~tiktok-cheap
 * Flags repeat for several candidates. Candidate rows run the identical query
 * at the same limit and report $/1k plus thumbnail coverage — an actor that
 * returns no thumbnail URL starves the face and synthetic-media layers, so a
 * cheap actor without thumbnails is not cheap.
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
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flagValues = (flag) =>
  args
    .filter((a) => a.startsWith(`${flag}=`))
    .map((a) => a.slice(flag.length + 1))
    .filter(Boolean);
const igHashtagCandidates = flagValues("--ig-hashtag-actor");
const tiktokCandidates = flagValues("--tiktok-actor");
const name = positional[0] ?? "Tom Hardy";
const limit = Number(positional[1] ?? 10);
const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameLower = name.toLowerCase();

// Same vocabulary the pre-filter uses, so the score reflects what would survive.
const AI_WORDS =
  /(^|[^a-z0-9])(ai|deepfake|deep fake|faceswap|face swap|synthetic|generated|midjourney|sora|veo|runway|concept trailer|fan made|fanmade|fan trailer|what if|reimagined|recast|unofficial)([^a-z0-9]|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function score(rows) {
  const named = rows.filter((r) => (r.text ?? "").toLowerCase().includes(nameLower));
  const synthetic = named.filter((r) => AI_WORDS.test(r.text ?? ""));
  const thumbs = rows.filter((r) => !!r.thumb).length;
  return {
    total: rows.length,
    named: named.length,
    synthetic: synthetic.length,
    thumbs,
    examples: synthetic.slice(0, 3),
  };
}

async function apifyRun(actor, input) {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actor}/runs?token=${encodeURIComponent(apifyToken)}&maxItems=${limit}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data } = await res.json();
  let status = data.status;
  let costUsd = 0;
  const deadline = Date.now() + 180_000;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    if (Date.now() > deadline) throw new Error("timeout");
    await sleep(4000);
    process.stdout.write(".");
    const poll = await fetch(`${APIFY_BASE}/actor-runs/${data.id}?token=${encodeURIComponent(apifyToken)}`);
    const body = (await poll.json()).data;
    status = body.status;
    // usageTotalUsd is computed async by Apify and often still 0 on a
    // just-finished run — treat the figure as a floor, not the invoice.
    costUsd = body.usageTotalUsd ?? costUsd;
  }
  if (status !== "SUCCEEDED") throw new Error(status);
  const items = await (
    await fetch(
      `${APIFY_BASE}/datasets/${data.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(apifyToken)}`
    )
  ).json();
  return { items: items.filter((i) => i && !i.error), costUsd };
}

// Map IG/TikTok items to score rows. `thumb` is the field the face and
// synthetic layers depend on downstream — coverage matters as much as yield.
const mapIg = (i) => ({
  text: `${i.caption ?? ""} ${(i.hashtags ?? []).join(" ")}`,
  url: i.url,
  thumb: i.displayUrl ?? null,
});
const mapTikTok = (i) => ({
  text: i.text ?? "",
  url: i.webVideoUrl,
  thumb: i.videoMeta?.coverUrl ?? i.videoMeta?.originalCoverUrl ?? null,
});

// A candidate with an unknown input schema gets the superset shape the app
// sends for overridden actors (lib/monitor/ingest/instagram.ts / tiktok.ts).
const igHashtagInput = (actor, tag) =>
  actor === "apify~instagram-hashtag-scraper"
    ? { hashtags: [tag], resultsLimit: limit }
    : { hashtags: [tag], hashtag: tag, resultsLimit: limit, maxItems: limit, limit };
const tiktokInput = (actor, q) =>
  actor === "clockworks~tiktok-scraper"
    ? { searchQueries: [q], resultsPerPage: limit, shouldDownloadVideos: false }
    : {
        searchQueries: [q],
        keywords: [q],
        search: q,
        resultsPerPage: limit,
        maxItems: limit,
        resultsLimit: limit,
        shouldDownloadVideos: false,
      };

const igActorSource = (actor, tag, note) => ({
  label: `IG hashtag #${tag} — ${actor}${note ? ` (${note})` : ""}`,
  enabled: () => !!apifyToken,
  run: async () => {
    const { items, costUsd } = await apifyRun(actor, igHashtagInput(actor, tag));
    return { rows: items.map(mapIg), costUsd };
  },
});
const tiktokActorSource = (actor, q, note) => ({
  label: `TikTok "${q}" — ${actor}${note ? ` (${note})` : ""}`,
  enabled: () => !!apifyToken,
  run: async () => {
    const { items, costUsd } = await apifyRun(actor, tiktokInput(actor, q));
    return { rows: items.map(mapTikTok), costUsd };
  },
});

const SOURCES = [
  igActorSource("apify~instagram-hashtag-scraper", slug, "incumbent, bare name"),
  igActorSource("apify~instagram-hashtag-scraper", `${slug}ai`, "incumbent"),
  ...igHashtagCandidates.map((actor) => igActorSource(actor, slug, "candidate")),
  tiktokActorSource("clockworks~tiktok-scraper", `${name} ai`, "incumbent"),
  ...tiktokCandidates.map((actor) => tiktokActorSource(actor, `${name} ai`, "candidate")),
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
      const rows = (body.items ?? []).map((i) => ({
        text: `${i.snippet?.title ?? ""} ${i.snippet?.description ?? ""}`,
        url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
        thumb: i.snippet?.thumbnails?.default?.url ?? null,
      }));
      return { rows, costUsd: 0 };
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
    const { rows, costUsd } = await source.run();
    const s = score(rows);
    results.push({ label: source.label, costUsd, ...s });
    const perThousand = s.total > 0 && costUsd > 0 ? ` · $${((costUsd / s.total) * 1000).toFixed(2)}/1k` : "";
    const thumbPct = s.total > 0 ? ` · ${Math.round((s.thumbs / s.total) * 100)}% thumbnails` : "";
    console.log(
      `\n  ${s.total} result(s) · ${s.named} mention the name · ${s.synthetic} read as synthetic` +
        `${thumbPct} · $${costUsd.toFixed(4)} reported${perThousand}`
    );
    for (const ex of s.examples) {
      console.log(`    · ${(ex.text ?? "").replace(/\s+/g, " ").slice(0, 88)}…`);
      console.log(`      ${ex.url}`);
    }
  } catch (err) {
    console.log(`\n  FAILED: ${err.message}`);
    results.push({ label: source.label, total: 0, named: 0, synthetic: 0, thumbs: 0, costUsd: 0 });
  }
}

console.log(`\n${"═".repeat(66)}`);
console.log("YIELD (synthetic hits per source — this is the number that matters)\n");
for (const r of [...results].sort((a, b) => b.synthetic - a.synthetic)) {
  const bar = "█".repeat(Math.min(30, r.synthetic * 3)) || "·";
  console.log(`  ${String(r.synthetic).padStart(3)}  ${bar}  ${r.label}`);
}
console.log("\nA source finding nothing here is a source not worth its query budget.");
