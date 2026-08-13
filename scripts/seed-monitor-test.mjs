#!/usr/bin/env node
/**
 * Seed a local D1 database with a talent account for an end-to-end likeness
 * monitor smoke test. Prints a session cookie you can curl the scan endpoint
 * with — no login flow, no TOTP, no onboarding.
 *
 * The target talent is Scarlett Johansson: the bakeoff showed both her
 * `#scarlettjohanssonai` hashtag and her TikTok signature return real synthetic
 * content, so she's the clearest positive test case for whether hits actually
 * translate into UI rows.
 *
 * Usage:
 *   node scripts/seed-monitor-test.mjs
 *
 * Reads JWT_SECRET from .env.local. Writes to the miniflare local D1 via
 * `wrangler d1 execute --local`. Idempotent — re-running clears the previous
 * scan state for the seeded talent so a fresh sweep starts clean.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

function readEnv(key) {
  if (process.env[key]?.trim()) return process.env[key].trim();
  // .dev.vars is what wrangler surfaces to env.* under `next dev`, so it wins
  // for anything signed and verified by the app runtime (JWT_SECRET most of
  // all). .env.local is a fallback for keys not present in .dev.vars.
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

const JWT_SECRET = readEnv("JWT_SECRET");
if (!JWT_SECRET) {
  console.error("JWT_SECRET missing from .env.local");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const userId = randomUUID();
const email = `scarjo-monitortest-${now}@example.com`;
// bcrypt hash of "not-used-jwt-only"; we never log in with this. NOT NULL requires a value.
const passwordHash = "$2a$10$C6UzMDM.H6dfI/f/IKcEeu9x9pPfB4B0/HgDXKJHVpBHzCiJk1QO2";

const scarjoTmdb = {
  tmdbId: 1245,
  fullName: "Scarlett Johansson",
  profileImageUrl: "https://image.tmdb.org/t/p/w500/6NsMbJXRlDZuDzatN2akFdGuTvx.jpg",
  knownFor: JSON.stringify([
    { title: "Black Widow", year: 2021, type: "movie" },
    { title: "Avengers: Endgame", year: 2019, type: "movie" },
    { title: "Lost in Translation", year: 2003, type: "movie" },
    { title: "Marriage Story", year: 2019, type: "movie" },
    { title: "Her", year: 2013, type: "movie" },
  ]),
  popularity: 92.4,
};

// Fresh state — if the previous run left a monitor + scan around, drop them so
// this run's sweep is definitionally the one being tested.
const cleanup = `
DELETE FROM monitor_scans WHERE talent_id IN (SELECT id FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com');
DELETE FROM likeness_hits WHERE talent_id IN (SELECT id FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com');
DELETE FROM likeness_monitors WHERE talent_id IN (SELECT id FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com');
DELETE FROM apify_usage WHERE talent_id IN (SELECT id FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com');
DELETE FROM talent_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com');
DELETE FROM users WHERE email LIKE 'scarjo-monitortest-%@example.com';
`;

const seed = `
INSERT INTO users (id, email, password_hash, role, created_at)
  VALUES ('${userId}', '${email}', '${passwordHash}', 'talent', ${now});

INSERT INTO talent_profiles (user_id, full_name, tmdb_id, profile_image_url, known_for, popularity, onboarded_at)
  VALUES ('${userId}', '${scarjoTmdb.fullName.replace(/'/g, "''")}', ${scarjoTmdb.tmdbId}, '${scarjoTmdb.profileImageUrl}', '${scarjoTmdb.knownFor.replace(/'/g, "''")}', ${scarjoTmdb.popularity}, ${now});

INSERT INTO likeness_monitors (id, talent_id, status, sensitivity, scope, cadence, allowlist_json, created_at, updated_at)
  VALUES ('${randomUUID()}', '${userId}', 'active', 'balanced', 'ai_only', 'weekly', '[]', ${now}, ${now});
`;

const dir = mkdtempSync(join(tmpdir(), "monitor-seed-"));
const cleanupPath = join(dir, "cleanup.sql");
const seedPath = join(dir, "seed.sql");
writeFileSync(cleanupPath, cleanup);
writeFileSync(seedPath, seed);

console.log("▸ Cleaning previous scarjo-monitortest state…");
execSync(`npx wrangler d1 execute image-vault-db --local --file ${JSON.stringify(cleanupPath)}`, {
  stdio: "inherit",
});

console.log("\n▸ Seeding talent + profile + monitor…");
execSync(`npx wrangler d1 execute image-vault-db --local --file ${JSON.stringify(seedPath)}`, {
  stdio: "inherit",
});

const secret = new TextEncoder().encode(JWT_SECRET);
const jwt = await new SignJWT({ email, role: "talent" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuedAt()
  .setIssuer("image-vault")
  .setAudience("image-vault-app")
  .setExpirationTime("2h")
  .sign(secret);

console.log("\n═".padEnd(66, "═"));
console.log("SEED COMPLETE");
console.log("═".padEnd(66, "═"));
console.log(`Talent id : ${userId}`);
console.log(`Email     : ${email}`);
console.log(`Session   : ${jwt}`);
console.log("\nCURL — trigger scan:");
console.log(
  `  curl -X POST http://localhost:3000/api/monitor/scan -H "Cookie: session=${jwt}"`
);
console.log("\nBROWSER — paste into DevTools cookie:");
console.log(`  document.cookie = "session=${jwt}; path=/"`);
console.log("  then open http://localhost:3000/vault/monitor");
console.log("");
