/**
 * End-to-end print check for the chain-of-custody record.
 *
 * Drives a real browser against the real dev server and asserts on the actual
 * PDF, because the two things this guards were previously only ever verified
 * against a synthetic HTML stand-in:
 *
 *   1. The record must paginate. The app shell is `h-screen overflow-hidden`,
 *      which in print makes the page box one viewport tall with overflow hidden
 *      and silently discards everything below the fold. A long record coming out
 *      as a single page is the regression.
 *   2. The live-access panel must NOT reach paper. It reports state that changes
 *      between load and print, so it has no business on a document meant to be a
 *      fixed extract.
 *
 * Prerequisites:
 *   npx wrangler d1 migrations apply image-vault-db --local
 *   npm run seed:custody
 *   npm run dev            # in another shell
 *
 * Then: npm run check:print
 *
 * Exits non-zero on any failed assertion, printing what it actually saw.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { SignJWT } from "jose";
import { pdfPages } from "./pdf-text.mjs";

const require = createRequire(import.meta.url);

// Playwright is installed globally in this environment, not as a project
// dependency — resolve it from there rather than adding a dep for one check.
function loadPlaywright() {
  const candidates = [
    "playwright-core",
    "playwright",
    "/opt/node22/lib/node_modules/playwright-core",
    "/opt/node22/lib/node_modules/playwright",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try the next one */
    }
  }
  throw new Error(`Could not resolve Playwright. Tried: ${candidates.join(", ")}`);
}

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "__tests__/e2e/report";
const PACKAGE_ID = "fixture-package-0001";
const TALENT_ID = "fixture-talent-0001";
const TALENT_EMAIL = "tom.hardy@fixture.test";

// Strings that identify the screen-only chrome. If any reaches the PDF the
// document is carrying live state it should not.
const LIVE_PANEL_MARKER = "Access right now";
const INLAY_MARKER = "on the permanent record";

// Much of the document is uppercased by CSS `text-transform`. Chromium bakes
// that into the glyphs it writes, and `innerText` applies it too, so every
// comparison here is case-insensitive — a case-sensitive absence assertion
// would pass for the wrong reason.
const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());

const failures = [];
const notes = [];

function check(label, condition, detail = "") {
  if (condition) {
    notes.push(`  ✓ ${label}`);
  } else {
    failures.push(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** JWT_SECRET as the app sees it: .dev.vars for the worker context. */
function readJwtSecret() {
  const raw = readFileSync(".dev.vars", "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("JWT_SECRET="));
  if (!line) throw new Error("JWT_SECRET not found in .dev.vars");
  return line.slice("JWT_SECRET=".length).trim();
}

/** Mirrors lib/auth/jwt.ts — same issuer, audience and algorithm. */
async function mintSession(secret) {
  return new SignJWT({ email: TALENT_EMAIL, role: "talent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(TALENT_ID)
    .setIssuedAt()
    .setIssuer("image-vault")
    .setAudience("image-vault-app")
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secret));
}

async function main() {
  const { chromium } = loadPlaywright();
  mkdirSync(OUT_DIR, { recursive: true });

  const token = await mintSession(readJwtSecret());
  // PLAYWRIGHT_BROWSERS_PATH points at the shared browser install, so the
  // default resolution is correct here; CHROMIUM_PATH is the escape hatch.
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addCookies([
    {
      name: "session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const url = `${BASE}/vault/packages/${PACKAGE_ID}/chain-of-custody`;
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  check(`page responds 200 (${url})`, res && res.status() === 200, `got ${res?.status()}`);

  // The record loads client-side; wait for the document rather than a timer.
  await page.waitForSelector(".doc-body", { timeout: 90_000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".event-row, .doc-keep").length > 20,
    { timeout: 90_000 },
  );

  // The live panel is a second, independent fetch that resolves after the
  // record does. Wait for it rather than racing it — but bounded, so a panel
  // that never arrives becomes a reported failure instead of a thrown timeout.
  await page
    .waitForFunction(
      (marker) => document.body.innerText.toLowerCase().includes(marker),
      LIVE_PANEL_MARKER.toLowerCase(),
      { timeout: 20_000 },
    )
    .catch(() => {});

  const screenText = await page.evaluate(() => document.body.innerText);

  // ── On screen ─────────────────────────────────────────────────────────────
  check("record renders the performer", has(screenText, "Tom Hardy"));
  check("record renders the package", has(screenText, "Full_Body_Havoc"));
  check(
    "tamper seal reports verified (a break here means the SEED is wrong)",
    has(screenText, "Tamper seal · verified"),
    has(screenText, "integrity failure") ? "seal reports integrity failure" : "seal text not found",
  );
  // This is the positive control for the PDF absence assertion below: if the
  // panel never rendered, its absence from print would prove nothing.
  check("live panel is visible on screen", has(screenText, LIVE_PANEL_MARKER));
  check(
    "live panel names the seeded vendor session",
    has(screenText, "NORTHLIGHT-RENDER-04") || has(screenText, "vfx@northlight.test"),
  );
  check("screen-only Inlay is visible on screen", has(screenText, INLAY_MARKER));
  check("file manifest lists a seeded file", has(screenText, "head_highpoly.obj"));

  await page.screenshot({ path: join(OUT_DIR, "custody-screen.png"), fullPage: false });

  // ── In print ──────────────────────────────────────────────────────────────
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  writeFileSync(join(OUT_DIR, "custody-record.pdf"), pdf);

  const pageTexts = pdfPages(pdf);
  const pages = pageTexts.length;
  const text = pageTexts.join("");
  // Written out so a failed assertion can be read rather than guessed at.
  writeFileSync(
    join(OUT_DIR, "custody-record.pages.txt"),
    pageTexts.map((t, i) => `───── page ${i + 1} (${t.length} chars) ─────\n${t}\n`).join("\n"),
  );
  writeFileSync(join(OUT_DIR, "custody-screen.txt"), screenText);

  // Guards every assertion below it. An extractor that returns nothing turns
  // each absence check into a false pass, which is the one failure mode this
  // whole script exists to avoid.
  check(
    "PDF text extraction produced text (a break here voids every check below)",
    text.length > 2000,
    `${text.length} chars`,
  );

  check(`record paginates beyond one page (got ${pages})`, pages > 1, `${pages} page(s)`);
  // A clamped shell does not only lose pages — it also leaves near-empty ones
  // where content was cut. Both shapes are caught here.
  const thin = pageTexts.map((t, i) => [i + 1, t.length]).filter(([, n]) => n < 200);
  check(
    "no page came out empty or near-empty",
    thin.length === 0,
    thin.map(([p, n]) => `p${p}:${n} chars`).join(", "),
  );
  check("cover is page 1", has(pageTexts[0], "Chain of custody record"));
  check(
    "the event log runs past the cover",
    pageTexts.slice(1).some((t) => has(t, "Event log")),
  );
  check("legal notice survives to the PDF", has(text, "Legal notice"));
  check("file manifest survives to the PDF", has(text, "head_highpoly.obj"));
  // Content below the first page is the whole point: if the shell clamps, this
  // is what disappears while the cover still looks fine.
  check("the closing mark survives to the PDF", has(text, "End of record"));
  check("a late ledger entry survives to the PDF", has(text, "fixture-licence-0003"));

  check("live panel is ABSENT from the PDF", !has(text, LIVE_PANEL_MARKER));
  check("screen-only Inlay is ABSENT from the PDF", !has(text, INLAY_MARKER));
  check("screen nav is ABSENT from the PDF", !has(text, "Print / Export PDF"));

  check("no console errors on the page", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await browser.close();

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\nPrint check — chain of custody\n");
  for (const n of notes) console.log(n);
  if (failures.length) {
    console.log("");
    for (const f of failures) console.log(f);
    console.log(`\n${failures.length} check(s) failed. PDF written to ${OUT_DIR}/custody-record.pdf\n`);
    process.exit(1);
  }
  console.log(`\nAll ${notes.length} checks passed. ${pages}-page PDF at ${OUT_DIR}/custody-record.pdf\n`);
}

main().catch((err) => {
  console.error("\nPrint check errored:", err);
  process.exit(1);
});
