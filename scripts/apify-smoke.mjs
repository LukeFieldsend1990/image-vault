#!/usr/bin/env node
/**
 * Apify smoke test — one tiny run, no app, no database.
 *
 * Purpose: verify the actor field names our mapper depends on actually exist in
 * live output. Those names came from Apify's docs rather than from a run we had
 * seen, which is the single largest unverified assumption in Phase 1 discovery.
 * Finding out here costs about a cent; finding out inside a sweep costs a
 * confusing debugging session.
 *
 * Usage:
 *   node scripts/apify-smoke.mjs                    # #tomhardyai, 5 results
 *   node scripts/apify-smoke.mjs tomhardydeepfake 3
 *
 * Reads APIFY_TOKEN from the environment, falling back to .env.local (what
 * `next dev` loads) and then .dev.vars (what `npm run preview`/workerd loads).
 */

import { readFileSync } from "node:fs";

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "apify~instagram-hashtag-scraper";

// Every field lib/monitor/ingest/instagram.ts reads off an item.
const REQUIRED = ["url", "ownerUsername"];
const OPTIONAL = [
  "shortCode",
  "caption",
  "hashtags",
  "timestamp",
  "likesCount",
  "videoViewCount",
  "videoPlayCount",
  "displayUrl",
  "videoUrl",
  "ownerFullName",
  "ownerId",
  "isVerified",
  "followersCount",
];

function readToken() {
  if (process.env.APIFY_TOKEN?.trim()) return process.env.APIFY_TOKEN.trim();

  // .env.local is what `next dev` reads and where this project's local secrets
  // actually live; .dev.vars only matters under `npm run preview` (workerd).
  for (const file of [".env.local", ".dev.vars"]) {
    try {
      const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .find((l) => l.trim().startsWith("APIFY_TOKEN="));
      const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    } catch {
      // try the next file
    }
  }

  console.error("No APIFY_TOKEN found in the environment, .env.local or .dev.vars.");
  process.exit(1);
}

const token = readToken();
const hashtag = process.argv[2] ?? "tomhardyai";
const limit = Number(process.argv[3] ?? 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n▸ #${hashtag} — requesting ${limit} results\n`);

const startRes = await fetch(
  `${APIFY_BASE}/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}&maxItems=${limit}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hashtags: [hashtag], resultsLimit: limit }),
  }
);

if (!startRes.ok) {
  console.error(`Start failed: ${startRes.status} ${await startRes.text()}`);
  if (startRes.status === 401 || startRes.status === 403) {
    console.error("→ Token rejected. Check it has Actors → Run permission.");
  }
  process.exit(1);
}

const { data: run } = await startRes.json();
console.log(`run ${run.id} — polling…`);

let status = run.status;
let cost = run.usageTotalUsd ?? null;
const deadline = Date.now() + 180_000;

while (status !== "SUCCEEDED") {
  if (["FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT"].includes(status)) {
    console.error(`\n✗ Run ended ${status}.`);
    console.error("→ If Permission mode is Restricted, the actor may need wider scope.");
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error("\n✗ Timed out after 3 minutes.");
    process.exit(1);
  }
  await sleep(4000);
  const poll = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${encodeURIComponent(token)}`);
  const { data } = await poll.json();
  status = data.status;
  if (typeof data.usageTotalUsd === "number") cost = data.usageTotalUsd;
  process.stdout.write(".");
}

const itemsRes = await fetch(
  `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?clean=true&token=${encodeURIComponent(token)}`
);
const items = await itemsRes.json();

console.log(`\n\n✓ ${items.length} item(s)\n`);

// ── The thing this script exists for ────────────────────────────────────────
console.log("COST");
if (cost === null) {
  console.log("  usageTotalUsd: NOT REPORTED");
  console.log("  → Ceiling falls back to per-item estimates ('est.' in the ledger).");
  console.log("    Widen the token's run-read permission to fix.\n");
} else if (cost === 0 && items.length > 0) {
  console.log("  usageTotalUsd: $0 despite returning items");
  console.log("  → Apify computes usage asynchronously; it is not populated at the");
  console.log("    moment the run reports SUCCEEDED. effectiveRunCost() treats this");
  console.log("    as unreported and estimates instead, so the ceiling stays honest.\n");
} else {
  console.log(`  usageTotalUsd: $${cost} — real figure, ceiling will be exact\n`);
}

if (!items.length) {
  console.log("No items returned — try a busier hashtag (e.g. 'aivideo') to check mapping.");
  process.exit(0);
}

const sample = items[0];
const missingRequired = REQUIRED.filter((f) => sample[f] === undefined);
const missingOptional = OPTIONAL.filter((f) => sample[f] === undefined);

console.log("FIELD MAPPING");
for (const f of REQUIRED) {
  console.log(`  ${sample[f] === undefined ? "✗" : "✓"} ${f}  (required)`);
}
for (const f of OPTIONAL) {
  console.log(`  ${sample[f] === undefined ? "·" : "✓"} ${f}`);
}

if (missingRequired.length) {
  console.log(`\n⚠ REQUIRED FIELDS MISSING: ${missingRequired.join(", ")}`);
  console.log("  mapInstagramItem() will drop every item. Fix the mapping before scanning.");
} else if (missingOptional.length) {
  console.log(`\n· Absent optional fields: ${missingOptional.join(", ")}`);
  console.log("  These degrade gracefully (null signals), but check the names below.");
} else {
  console.log("\n✓ Every expected field present — mapping is good.");
}

console.log("\nACTUAL KEYS ON ITEM 0");
console.log(" ", Object.keys(sample).join(", "));

console.log("\nSAMPLE ITEM");
console.log(JSON.stringify(sample, null, 2).slice(0, 2000));
