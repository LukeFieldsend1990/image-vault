#!/usr/bin/env node
/**
 * Find a working Instagram profile-harvest route.
 *
 * `apify/instagram-scraper` + directUrls on a profile returns
 * "not_found — Post does not exist", which blocks account watch entirely.
 * Two possibilities worth separating before rewriting anything:
 *
 *   a) the handle was wrong (the reel's ownerUsername was `leakingai`, while
 *      "Reveal.Ai" appears to be branding burnt into the video), or
 *   b) the actor/input shape is wrong for profile listing.
 *
 * This runs a matrix of actor × input shape against handles we have *proven*
 * exist, and reports which combinations return posts. Small limits throughout.
 *
 * Usage: node scripts/apify-profile-matrix.mjs [handle]
 */

import { readFileSync } from "node:fs";

const APIFY_BASE = "https://api.apify.com/v2";
const LIMIT = 3;

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
const handle = (process.argv[2] ?? "leakingai").replace(/^@/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMBOS = [
  {
    label: "instagram-scraper · directUrls(profile) + resultsType:posts",
    actor: "apify~instagram-scraper",
    input: {
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: LIMIT,
    },
  },
  {
    label: "instagram-scraper · username[] + resultsType:posts",
    actor: "apify~instagram-scraper",
    input: { username: [handle], resultsType: "posts", resultsLimit: LIMIT },
  },
  {
    label: "instagram-scraper · directUrls + addParentData",
    actor: "apify~instagram-scraper",
    input: {
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: LIMIT,
      addParentData: true,
      searchType: "user",
    },
  },
  {
    label: "instagram-post-scraper · username[]",
    actor: "apify~instagram-post-scraper",
    input: { username: [handle], resultsLimit: LIMIT },
  },
  {
    label: "instagram-reel-scraper · username[]",
    actor: "apify~instagram-reel-scraper",
    input: { username: [handle], resultsLimit: LIMIT },
  },
  {
    label: "instagram-profile-scraper · usernames[]",
    actor: "apify~instagram-profile-scraper",
    input: { usernames: [handle] },
  },
];

async function tryCombo({ label, actor, input }) {
  process.stdout.write(`\n▸ ${label}\n  `);
  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/${actor}/runs?token=${encodeURIComponent(token)}&maxItems=${LIMIT}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }
    );
    if (!res.ok) {
      console.log(`start HTTP ${res.status}${res.status === 404 ? " (actor does not exist)" : ""}`);
      return { label, posts: 0, note: `HTTP ${res.status}` };
    }
    const { data } = await res.json();
    let status = data.status;
    const deadline = Date.now() + 150_000;
    while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
      if (Date.now() > deadline) {
        console.log("timeout");
        return { label, posts: 0, note: "timeout" };
      }
      await sleep(4000);
      process.stdout.write(".");
      const poll = await fetch(`${APIFY_BASE}/actor-runs/${data.id}?token=${encodeURIComponent(token)}`);
      status = (await poll.json()).data.status;
    }
    if (status !== "SUCCEEDED") {
      console.log(status);
      return { label, posts: 0, note: status };
    }

    const items = await (
      await fetch(
        `${APIFY_BASE}/datasets/${data.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(token)}`
      )
    ).json();
    const posts = items.filter((i) => i?.ownerUsername && i?.url && !i?.error);
    const errored = items.filter((i) => i?.error);

    console.log(`\n  ${items.length} item(s) · ${posts.length} usable post(s)`);
    if (posts.length) {
      const p = posts[0];
      console.log(`    @${p.ownerUsername} type=${p.type} tags=${(p.hashtags ?? []).length} plays=${p.videoPlayCount ?? "?"}`);
      console.log(`    ${String(p.caption ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
      return { label, posts: posts.length, note: "OK" };
    }
    if (errored.length) {
      console.log(`    error: ${errored[0].error} — ${errored[0].errorDescription ?? ""}`);
      return { label, posts: 0, note: errored[0].error };
    }
    if (items.length) {
      console.log(`    keys: ${Object.keys(items[0]).slice(0, 12).join(", ")}`);
      return { label, posts: 0, note: "non-post shape" };
    }
    return { label, posts: 0, note: "empty" };
  } catch (err) {
    console.log(`threw: ${err.message}`);
    return { label, posts: 0, note: "threw" };
  }
}

console.log(`\nProfile harvest matrix — @${handle}\n${"═".repeat(62)}`);
const results = [];
for (const combo of COMBOS) results.push(await tryCombo(combo));

console.log(`\n${"═".repeat(62)}\nRESULT\n`);
const winners = results.filter((r) => r.posts > 0);
for (const r of results) {
  console.log(`  ${r.posts > 0 ? "✓" : "✗"} ${String(r.posts).padStart(2)} posts  ${r.note.padEnd(16)} ${r.label}`);
}
console.log(
  winners.length
    ? `\n→ Use: ${winners[0].label}`
    : "\n→ No working route. Account watch stays blocked; the watchlist can be built but not harvested."
);
