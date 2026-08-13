#!/usr/bin/env node
/**
 * Pick a real TMDB-linked talent from the (now remote) D1 and mint a session
 * JWT for them. Replaces scripts/seed-monitor-test.mjs, which created a fake
 * scarjo-monitortest-* user each run — now that `next dev` talks to prod, the
 * 4 real talents (Tom Hardy, Channing Tatum, Walton Goggins, Lily-Rose Depp)
 * are the test accounts and there is no reason to fabricate more.
 *
 * Usage:
 *   node scripts/monitor-target.mjs               # list available talents
 *   node scripts/monitor-target.mjs "Tom Hardy"   # mint JWT for the named talent
 *   node scripts/monitor-target.mjs tom           # partial match on full_name
 *
 * The JWT is signed with the JWT_SECRET the running app uses (via .dev.vars,
 * which is what wrangler surfaces to env.*). Copy the printed cookie into a
 * browser, or curl the scan endpoint with it.
 *
 * This script does NOT clear scan state. Repeated runs against the same talent
 * accumulate hits — which is what we want for testing the delta-detection code
 * paths (previousUrls dedupe, monitor_accounts hit_count aggregation, etc.).
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { SignJWT } from "jose";

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

function d1(sql) {
  const escaped = JSON.stringify(sql);
  const raw = execSync(
    `npx wrangler d1 execute image-vault-db --remote --command ${escaped} --json`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  // wrangler prints a banner before the JSON; find the first '['.
  const jsonStart = raw.indexOf("[");
  if (jsonStart < 0) throw new Error(`wrangler returned no JSON:\n${raw}`);
  const parsed = JSON.parse(raw.slice(jsonStart));
  return parsed[0]?.results ?? [];
}

const JWT_SECRET = readEnv("JWT_SECRET");
if (!JWT_SECRET) {
  console.error("JWT_SECRET missing from .dev.vars / .env.local");
  process.exit(1);
}

const query = process.argv[2];

console.log("▸ Looking up TMDB-linked talents (remote D1)…\n");
const rows = d1(
  "SELECT u.id, u.email, tp.full_name, tp.tmdb_id, tp.popularity, tp.enforcement_authorization_on_file " +
    "FROM users u JOIN talent_profiles tp ON tp.user_id = u.id " +
    "WHERE u.role='talent' AND tp.tmdb_id IS NOT NULL " +
    "ORDER BY tp.popularity DESC"
);

if (!rows.length) {
  console.error("No TMDB-linked talents found in production.");
  process.exit(1);
}

if (!query) {
  console.log("Available talents:\n");
  for (const r of rows) {
    const auth = r.enforcement_authorization_on_file ? "auth✓" : "auth✗";
    console.log(`  · ${r.full_name.padEnd(24)} tmdb ${String(r.tmdb_id).padEnd(8)} pop ${String(r.popularity).padEnd(6)} ${auth}  <${r.email}>`);
  }
  console.log("\nUsage: node scripts/monitor-target.mjs \"Tom Hardy\"\n");
  process.exit(0);
}

const q = query.toLowerCase();
const match =
  rows.find((r) => r.full_name.toLowerCase() === q) ??
  rows.find((r) => r.full_name.toLowerCase().includes(q));

if (!match) {
  console.error(`No talent matched "${query}". Available:`);
  for (const r of rows) console.error(`  · ${r.full_name}`);
  process.exit(1);
}

const secret = new TextEncoder().encode(JWT_SECRET);
const jwt = await new SignJWT({ email: match.email, role: "talent" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(match.id)
  .setIssuedAt()
  .setIssuer("image-vault")
  .setAudience("image-vault-app")
  .setExpirationTime("2h")
  .sign(secret);

console.log(`Target : ${match.full_name} (tmdb ${match.tmdb_id})`);
console.log(`Email  : ${match.email}`);
console.log(`User   : ${match.id}`);
console.log(`Auth   : ${match.enforcement_authorization_on_file ? "on file (Send-report enabled)" : "NOT on file (Send-report disabled)"}`);
console.log(`Session: ${jwt}\n`);

console.log("CURL — trigger scan:");
console.log(`  curl -X POST http://localhost:3000/api/monitor/scan -H "Cookie: session=${jwt}"\n`);

console.log("BROWSER — paste into DevTools cookie on localhost:3000:");
console.log(`  document.cookie = "session=${jwt}; path=/"`);
console.log("  then open http://localhost:3000/vault/monitor\n");
