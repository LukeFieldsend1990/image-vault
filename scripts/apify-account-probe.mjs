#!/usr/bin/env node
/**
 * Probe the account-watch path (discovery Mode B) against a real offender.
 *
 * Keyword post search is not reachable through Apify, and the target content
 * carries no hashtags — so account harvesting is the only route left to it.
 * This checks whether that route actually works: does the profile actor return
 * the posts, do captions carry the talent's name, and do the profile-level
 * fields (followers) that hashtag sweeps lack come through here.
 *
 * Usage: node scripts/apify-account-probe.mjs [handle] [limit] [shortCodeToFind]
 */

import { readFileSync } from "node:fs";

const APIFY_BASE = "https://api.apify.com/v2";

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
const handle = (process.argv[2] ?? "reveal.aii").replace(/^@/, "");
const limit = Number(process.argv[3] ?? 20);
const findShortCode = process.argv[4] ?? "DYV7w3lC5Gv";
const NAME = "tom hardy";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n▸ @${handle} — harvesting ${limit} recent posts\n`);

const startRes = await fetch(
  `${APIFY_BASE}/acts/apify~instagram-scraper/runs?token=${encodeURIComponent(token)}&maxItems=${limit}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${handle}/`],
      resultsType: "posts",
      resultsLimit: limit,
    }),
  }
);

if (!startRes.ok) {
  console.error(`Start failed: HTTP ${startRes.status}`);
  process.exit(1);
}

const { data: run } = await startRes.json();
let status = run.status;
let cost = run.usageTotalUsd ?? null;
const deadline = Date.now() + 240_000;

while (status !== "SUCCEEDED") {
  if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT"].includes(status)) {
    console.error(`Run ended ${status}`);
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error("Timed out");
    process.exit(1);
  }
  await sleep(4000);
  process.stdout.write(".");
  const poll = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${encodeURIComponent(token)}`);
  const { data } = await poll.json();
  status = data.status;
  if (typeof data.usageTotalUsd === "number") cost = data.usageTotalUsd;
}

const items = await (
  await fetch(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(token)}`
  )
).json();

const posts = items.filter((i) => i?.ownerUsername && i?.url && !i?.error);
console.log(`\n\n✓ ${posts.length} usable post(s)   cost reported: ${cost === null ? "null" : `$${cost}`}\n`);

if (!posts.length) {
  console.log("No posts — the account may be private, or the actor input shape is wrong.");
  console.log("shape:", items.length ? Object.keys(items[0]).join(", ") : "(empty)");
  process.exit(0);
}

const named = posts.filter((p) => (p.caption ?? "").toLowerCase().includes(NAME));
const untagged = posts.filter((p) => !(p.hashtags ?? []).length);
const target = posts.find((p) => p.shortCode === findShortCode);

console.log("DISCOVERY VIABILITY");
console.log(`  posts mentioning "${NAME}" in caption: ${named.length}/${posts.length}`);
console.log(`  posts carrying no hashtags:            ${untagged.length}/${posts.length}`);
console.log(`  target ${findShortCode}:                ${target ? "FOUND ✓" : "not in this page"}`);

console.log("\nPROFILE-LEVEL FIELDS (absent from hashtag sweeps)");
for (const f of ["followersCount", "isVerified", "ownerFullName", "videoPlayCount", "videoUrl"]) {
  const present = posts.some((p) => p[f] !== undefined);
  console.log(`  ${present ? "✓" : "·"} ${f}`);
}

if (target) {
  console.log("\nTARGET POST");
  console.log(`  url:      ${target.url}`);
  console.log(`  type:     ${target.type}`);
  console.log(`  hashtags: ${(target.hashtags ?? []).length ? target.hashtags.join(", ") : "(none)"}`);
  console.log(`  likes:    ${target.likesCount ?? "?"}   plays: ${target.videoPlayCount ?? "?"}`);
  console.log(`  caption:  ${(target.caption ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
}

if (named.length) {
  console.log("\nNAME-MATCHED POSTS");
  for (const p of named.slice(0, 5)) {
    console.log(`  ${p.shortCode} · ${(p.caption ?? "").replace(/\s+/g, " ").slice(0, 110)}…`);
  }
}
