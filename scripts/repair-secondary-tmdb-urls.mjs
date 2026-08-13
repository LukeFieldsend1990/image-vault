#!/usr/bin/env node
/**
 * Repair the seeded hit_secondary_actors rows whose tmdb_profile_url was
 * guessed rather than looked up. Hits TMDB by id, writes the real
 * profile_path back to remote D1.
 *
 * Usage: node scripts/repair-secondary-tmdb-urls.mjs
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function readEnv(key) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  for (const file of ["../.dev.vars", "../.env.local"]) {
    try {
      const line = readFileSync(new URL(file, import.meta.url), "utf8")
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

const TMDB_KEY = readEnv("TMDB_API_KEY");
if (!TMDB_KEY) {
  console.error("TMDB_API_KEY missing.");
  process.exit(1);
}

const rows = JSON.parse(
  execSync(
    `npx wrangler d1 execute image-vault-db --remote --command "SELECT DISTINCT tmdb_id FROM hit_secondary_actors WHERE tmdb_id IS NOT NULL" --json`,
    { encoding: "utf8" }
  ).slice(
    execSync(
      `npx wrangler d1 execute image-vault-db --remote --command "SELECT DISTINCT tmdb_id FROM hit_secondary_actors WHERE tmdb_id IS NOT NULL" --json`,
      { encoding: "utf8" }
    ).indexOf("[")
  )
)[0].results;

console.log(`\n▸ ${rows.length} distinct tmdb_id(s) to refresh\n`);

for (const { tmdb_id } of rows) {
  const res = await fetch(
    `https://api.themoviedb.org/3/person/${tmdb_id}?api_key=${encodeURIComponent(TMDB_KEY)}`
  );
  if (!res.ok) {
    console.log(`  · ${tmdb_id} — TMDB ${res.status}, skipping`);
    continue;
  }
  const person = await res.json();
  const url = person.profile_path
    ? `https://image.tmdb.org/t/p/w500${person.profile_path}`
    : null;
  if (!url) {
    console.log(`  · ${tmdb_id} (${person.name}) — no profile_path on TMDB, skipping`);
    continue;
  }

  execSync(
    `npx wrangler d1 execute image-vault-db --remote --command "UPDATE hit_secondary_actors SET tmdb_profile_url='${url}', tmdb_name='${person.name.replace(/'/g, "''")}' WHERE tmdb_id=${tmdb_id}"`,
    { stdio: "ignore" }
  );
  console.log(`  ✓ ${tmdb_id} — ${person.name} → ${url}`);
}

console.log("\nDone.");
