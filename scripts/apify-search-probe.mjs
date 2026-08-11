#!/usr/bin/env node
/**
 * Probe: can Apify reach Instagram's free-text post search?
 *
 * The in-app search for "tom hardy ai" returns the exact content we are hunting
 * (@reveal.aii's synthetic Venom trailer) — a post carrying NO hashtags, which
 * hashtag-based discovery can never surface. If no actor exposes that keyword
 * surface, per-talent discovery has to pivot to account-centric harvesting.
 *
 * Runs several actor/input combinations at tiny limits and reports which return
 * real posts. A few cents total.
 *
 * Usage: node scripts/apify-search-probe.mjs ["tom hardy ai"]
 */

import { readFileSync } from "node:fs";

const APIFY_BASE = "https://api.apify.com/v2";
const LIMIT = 5;

function readToken() {
  if (process.env.APIFY_TOKEN?.trim()) return process.env.APIFY_TOKEN.trim();
  for (const file of [".env.local", ".dev.vars"]) {
    try {
      const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .find((l) => l.trim().startsWith("APIFY_TOKEN="));
      const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    } catch {
      /* next */
    }
  }
  console.error("No APIFY_TOKEN found.");
  process.exit(1);
}

const token = readToken();
const query = process.argv[2] ?? "tom hardy ai";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMBOS = [
  {
    label: "instagram-scraper · search + resultsType:posts",
    actor: "apify~instagram-scraper",
    input: { search: query, searchType: "hashtag", resultsType: "posts", resultsLimit: LIMIT },
  },
  {
    label: "instagram-scraper · searchType:user",
    actor: "apify~instagram-scraper",
    input: { search: query, searchType: "user", resultsType: "posts", resultsLimit: LIMIT },
  },
  {
    label: "instagram-search-scraper · searchType:user",
    actor: "apify~instagram-search-scraper",
    input: { search: query, searchType: "user", resultsLimit: LIMIT },
  },
];

async function run({ label, actor, input }) {
  process.stdout.write(`\n▸ ${label}\n  `);
  try {
    const startRes = await fetch(
      `${APIFY_BASE}/acts/${actor}/runs?token=${encodeURIComponent(token)}&maxItems=${LIMIT}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
    );
    if (!startRes.ok) {
      console.log(`start failed: HTTP ${startRes.status}`);
      return;
    }
    const { data: run } = await startRes.json();
    let status = run.status;
    const deadline = Date.now() + 150_000;
    while (status !== "SUCCEEDED") {
      if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT"].includes(status)) {
        console.log(`run ${status}`);
        return;
      }
      if (Date.now() > deadline) {
        console.log("timed out");
        return;
      }
      await sleep(4000);
      process.stdout.write(".");
      const poll = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${encodeURIComponent(token)}`);
      status = (await poll.json()).data.status;
    }

    const items = await (
      await fetch(
        `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(token)}`
      )
    ).json();

    const posts = items.filter((i) => i?.ownerUsername && i?.url && !i?.error);
    console.log(`\n  ${items.length} item(s), ${posts.length} usable post(s)`);

    if (posts.length) {
      for (const p of posts.slice(0, 3)) {
        const cap = (p.caption ?? "").replace(/\s+/g, " ").slice(0, 90);
        const tags = (p.hashtags ?? []).length;
        console.log(`    @${p.ownerUsername} · ${tags} tag(s) · ${cap}…`);
      }
      const noTags = posts.filter((p) => !(p.hashtags ?? []).length).length;
      console.log(`    → ${noTags}/${posts.length} carry NO hashtags`);
    } else if (items.length) {
      console.log(`    shape: ${Object.keys(items[0]).slice(0, 10).join(", ")}`);
      if (items[0]?.error) console.log(`    error: ${items[0].error} — ${items[0].errorDescription ?? ""}`);
    }
  } catch (err) {
    console.log(`threw: ${err.message}`);
  }
}

console.log(`Query: "${query}" — probing free-text post discovery\n${"─".repeat(60)}`);
for (const combo of COMBOS) await run(combo);
console.log(`\n${"─".repeat(60)}`);
console.log("Looking for: any combo returning usable posts, especially untagged ones.");
