/**
 * Seed a realistic chain-of-custody fixture into the local D1 database.
 *
 * Written as a vitest spec rather than a standalone script for one reason: it
 * imports `hashEvent` from lib/compliance/ledger, so the compliance events it
 * writes carry chains that are *genuinely* valid. A hand-rolled hash would make
 * the record's tamper seal report a break, and any test running against this
 * fixture would then be measuring the wrong thing.
 *
 * Writes straight to the miniflare SQLite that `next dev` reads, via node:sqlite
 * — the Cloudflare binding is only available inside the worker, so the ORM is
 * not reachable from here.
 *
 *   npx wrangler d1 migrations apply image-vault-db --local
 *   npm run seed:custody
 *
 * Idempotent: it deletes anything it previously wrote (by the fixed ids below)
 * before inserting, so it can be re-run without piling up duplicates.
 */

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, hashEvent, licenceChain, talentChain } from "@/lib/compliance/ledger";

// ── Fixed ids, so re-running replaces rather than accumulates ────────────────
export const FIXTURE = {
  talentId: "fixture-talent-0001",
  talentEmail: "tom.hardy@fixture.test",
  repId: "fixture-rep-0001",
  licenseeA: "fixture-licensee-0001",
  licenseeB: "fixture-licensee-0002",
  packageId: "fixture-package-0001",
  licences: ["fixture-licence-0001", "fixture-licence-0002", "fixture-licence-0003"],
  deviceId: "fixture-device-0001",
  grantId: "fixture-grant-0001",
};

const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

/** The database file miniflare created — not `metadata.sqlite`, which is its own bookkeeping. */
function findLocalD1(): string {
  const files = readdirSync(D1_DIR).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one local D1 database in ${D1_DIR}, found ${files.length}. ` +
        `Run: npx wrangler d1 migrations apply image-vault-db --local`,
    );
  }
  return join(D1_DIR, files[0]);
}

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
/** Anchor the record in the past so the whole span is historical and stable. */
const T0 = NOW - 180 * DAY;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface LedgerSpec {
  chainKey: string;
  eventType: string;
  clauseRef: string | null;
  licenceId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * The event mix a real record carries: consent granted and later withdrawn,
 * dual-custody legs on every download, attestations, a transfer, a strike. Wide
 * enough that the printed record exercises every tone in the palette.
 */
function ledgerSpecs(): LedgerSpec[] {
  const [licA, licB, licC] = FIXTURE.licences;
  const out: LedgerSpec[] = [];
  const push = (
    chainKey: string,
    eventType: string,
    clauseRef: string | null,
    licenceId: string | null,
    dayOffset: number,
    payload: Record<string, unknown> = {},
  ) =>
    out.push({
      chainKey,
      eventType,
      clauseRef,
      licenceId,
      actorId: FIXTURE.talentId,
      payload,
      createdAt: T0 + dayOffset * DAY,
    });

  // Licence A — the long-running one: consent, several releases, a transfer.
  push(licenceChain(licA), "consent.granted", "39.B", licA, 5, { useType: "film_double" });
  push(licenceChain(licA), "consent.dub_language_granted", "39.D", licA, 5, { language: "fr" });
  push(licenceChain(licA), "package.attached", null, licA, 6);
  for (let i = 0; i < 6; i++) {
    push(licenceChain(licA), "download.initiated", null, licA, 10 + i * 7);
    push(licenceChain(licA), "custody.licensee_verified", null, licA, 10 + i * 7, { preauth: i > 3 });
    push(licenceChain(licA), "custody.talent_verified", null, licA, 10 + i * 7, { fileCount: 6 });
  }
  push(licenceChain(licA), "biometric.isolation_attested", "39.F", licA, 60);
  push(licenceChain(licA), "transfer.requested", null, licA, 72, { to: "Halfmoon VFX" });
  push(licenceChain(licA), "transfer.approved", null, licA, 74);
  push(licenceChain(licA), "business_reason.recorded", null, licA, 80, { reason: "reshoot coverage" });
  push(licenceChain(licA), "use.metered", "39.C", licA, 88, { units: 1200 });

  // Licence B — the one that goes wrong: consent withdrawn, then revoked.
  push(licenceChain(licB), "consent.granted", "39.B", licB, 40, { useType: "ai_avatar" });
  push(licenceChain(licB), "consent.counter_proposed", "39.B", licB, 44, { byParty: "talent" });
  push(licenceChain(licB), "training.notice_filed", "39.G", licB, 50);
  push(licenceChain(licB), "download.initiated", null, licB, 55);
  push(licenceChain(licB), "custody.licensee_verified", null, licB, 55);
  push(licenceChain(licB), "custody.talent_verified", null, licB, 55);
  push(licenceChain(licB), "consent.revoked", "39.B", licB, 96, { reason: "scope exceeded" });
  push(licenceChain(licB), "use.blocked", null, licB, 97);
  push(licenceChain(licB), "licence.revoked", null, licB, 98);
  push(licenceChain(licB), "replica.scrub_attested", "39.E", licB, 105);

  // Licence C — current and live, the one the live panel reports on.
  push(licenceChain(licC), "consent.granted", "39.B", licC, 120, { useType: "commercial" });
  push(licenceChain(licC), "package.attached", null, licC, 121);
  push(licenceChain(licC), "download.initiated", null, licC, 130);
  push(licenceChain(licC), "custody.licensee_verified", null, licC, 130);
  push(licenceChain(licC), "security.custody_attested", null, licC, 140);

  // Talent chain — platform-scoped, and the reason the record queries it at all.
  push(talentChain(FIXTURE.talentId), "data_controller.handover", "39.J", null, 2, {
    from: "Bellhouse Films",
  });

  return out;
}

describe("seed: chain-of-custody fixture", () => {
  it("writes a multi-production package with genuinely valid hash chains", async () => {
    const db = new DatabaseSync(findLocalD1());
    db.exec("PRAGMA foreign_keys = ON");

    // ── Clear anything this fixture wrote before ──────────────────────────────
    const ids = [
      FIXTURE.talentId,
      FIXTURE.repId,
      FIXTURE.licenseeA,
      FIXTURE.licenseeB,
    ];
    db.exec(`DELETE FROM compliance_events WHERE chain_key LIKE 'licence:fixture-%' OR chain_key LIKE 'talent:fixture-%'`);
    db.exec(`DELETE FROM document_seals WHERE subject_id LIKE 'fixture-%'`);
    db.exec(`DELETE FROM bridge_grants WHERE id LIKE 'fixture-%'`);
    db.exec(`DELETE FROM bridge_devices WHERE id LIKE 'fixture-%'`);
    db.exec(`DELETE FROM download_events WHERE id LIKE 'fixture-%'`);
    db.exec(`DELETE FROM scan_files WHERE package_id = '${FIXTURE.packageId}'`);
    db.exec(`DELETE FROM licences WHERE id LIKE 'fixture-%'`);
    db.exec(`DELETE FROM scan_packages WHERE id = '${FIXTURE.packageId}'`);
    db.exec(`DELETE FROM talent_profiles WHERE user_id LIKE 'fixture-%'`);
    for (const id of ids) db.exec(`DELETE FROM users WHERE id = '${id}'`);

    // ── People ────────────────────────────────────────────────────────────────
    const insertUser = db.prepare(
      `INSERT INTO users (id, email, password_hash, role, created_at, short_code) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Password hash is a placeholder: the print check forges a session cookie
    // rather than logging in, so no credential is ever verified.
    insertUser.run(FIXTURE.talentId, FIXTURE.talentEmail, "seed-not-a-real-hash", "talent", T0, "TH");
    insertUser.run(FIXTURE.repId, "agent@fixture.test", "seed-not-a-real-hash", "rep", T0, "AG");
    insertUser.run(FIXTURE.licenseeA, "vfx@northlight.test", "seed-not-a-real-hash", "licensee", T0, "NL");
    insertUser.run(FIXTURE.licenseeB, "post@halfmoon.test", "seed-not-a-real-hash", "licensee", T0, "HM");

    // talent_profiles is keyed on user_id — it has no separate id column.
    db.prepare(
      `INSERT INTO talent_profiles (user_id, full_name, onboarded_at) VALUES (?, ?, ?)`,
    ).run(FIXTURE.talentId, "Tom Hardy", T0);

    // ── Package and files ─────────────────────────────────────────────────────
    db.prepare(
      `INSERT INTO scan_packages (id, talent_id, name, capture_date, studio_name, status, created_at, updated_at, scan_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      FIXTURE.packageId,
      FIXTURE.talentId,
      "Full_Body_Havoc",
      T0 - 20 * DAY,
      "Almorah Capture Stage",
      "ready",
      T0,
      T0,
      1,
    );

    const files = [
      ["head_highpoly.obj", 412_000_000],
      ["head_lowpoly.obj", 18_400_000],
      ["body_highpoly.obj", 890_000_000],
      ["texture_albedo_8k.exr", 268_000_000],
      ["texture_normal_8k.exr", 268_000_000],
      ["rig_reference.fbx", 6_200_000],
    ] as const;

    const insertFile = db.prepare(
      `INSERT INTO scan_files (id, package_id, filename, size_bytes, r2_key, content_type, upload_status, sha256, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const fileIds: string[] = [];
    files.forEach(([name, size], i) => {
      const id = `fixture-file-000${i + 1}`;
      fileIds.push(id);
      insertFile.run(
        id,
        FIXTURE.packageId,
        name,
        size,
        `scans/${FIXTURE.packageId}/${name}`,
        "application/octet-stream",
        "complete",
        sha256Hex(`${FIXTURE.packageId}:${name}`), // deterministic, so the manifest is stable across runs
        T0 + DAY,
        T0 + DAY,
      );
    });

    // ── Licences across two productions ───────────────────────────────────────
    const insertLicence = db.prepare(
      `INSERT INTO licences (id, short_code, talent_id, package_id, licensee_id, project_name, production_company,
        intended_use, valid_from, valid_to, status, licence_type, approved_at, revoked_at, delivery_mode,
        preauth_until, permit_ai_training, created_at, download_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const [licA, licB, licC] = FIXTURE.licences;

    insertLicence.run(licA, "LC-1001", FIXTURE.talentId, FIXTURE.packageId, FIXTURE.licenseeA,
      "Ravensmoor", "Northlight Pictures", "Digital double for stunt coverage and de-aging.",
      T0 + 5 * DAY, NOW + 90 * DAY, "APPROVED", "film_double", T0 + 5 * DAY, null, "standard",
      NOW + 2 * DAY, 0, T0 + 4 * DAY, 18);

    insertLicence.run(licB, "LC-1002", FIXTURE.talentId, FIXTURE.packageId, FIXTURE.licenseeB,
      "Ravensmoor", "Northlight Pictures", "Generative avatar work for promotional assets.",
      T0 + 40 * DAY, T0 + 140 * DAY, "REVOKED", "ai_avatar", T0 + 40 * DAY, T0 + 98 * DAY, "standard",
      null, 1, T0 + 38 * DAY, 3);

    insertLicence.run(licC, "LC-1003", FIXTURE.talentId, FIXTURE.packageId, FIXTURE.licenseeA,
      "The Fifth Season", "Bellhouse Films", "Crowd tiles and background replication.",
      T0 + 120 * DAY, NOW + 200 * DAY, "APPROVED", "commercial", T0 + 120 * DAY, null, "standard",
      null, 0, T0 + 118 * DAY, 5);

    // ── Download events ───────────────────────────────────────────────────────
    const insertDl = db.prepare(
      `INSERT INTO download_events (id, licence_id, licensee_id, file_id, ip, user_agent, bytes_transferred, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let dl = 0;
    for (let i = 0; i < 6; i++) {
      for (const fid of fileIds.slice(0, 3)) {
        const at = T0 + (10 + i * 7) * DAY;
        insertDl.run(`fixture-dl-${String(++dl).padStart(3, "0")}`, licA, FIXTURE.licenseeA, fid,
          "203.0.113.44", "ImageVault-Bridge/2.1", 400_000_000, at, at + 900);
      }
    }
    // The performer's own access — flagged in the record rather than hidden.
    insertDl.run(`fixture-dl-${String(++dl).padStart(3, "0")}`, null, FIXTURE.talentId, fileIds[1],
      "198.51.100.7", "Mozilla/5.0", 18_400_000, T0 + 30 * DAY, T0 + 30 * DAY + 40);

    // ── A live bridge grant, so the live panel has something real to report ───
    db.prepare(
      `INSERT INTO bridge_devices (id, user_id, fingerprint, display_name, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(FIXTURE.deviceId, FIXTURE.licenseeA, "fp-fixture-0001", "NORTHLIGHT-RENDER-04", NOW - 20, T0);

    db.prepare(
      `INSERT INTO bridge_grants (id, licence_id, package_id, user_id, tool, device_id, allowed_tools,
         manifest_json, signature, key_id, expires_at, offline_until, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(FIXTURE.grantId, licA, FIXTURE.packageId, FIXTURE.licenseeA, "maya", FIXTURE.deviceId,
      JSON.stringify(["maya", "nuke"]), JSON.stringify({ files: fileIds.length }), "seed-signature",
      "bridge-signing-key-1", NOW + 3 * DAY, NOW + 5 * DAY, NOW - DAY, null);

    // ── The ledger — chains computed exactly as appendEvent does ──────────────
    const specs = ledgerSpecs();
    const tipByChain = new Map<string, { seq: number; hash: string }>();
    const insertEvent = db.prepare(
      `INSERT INTO compliance_events (id, chain_key, seq, event_type, regime, clause_ref, licence_id, talent_id,
         organisation_id, actor_id, scope_json, payload_json, prev_hash, hash, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let n = 0;
    for (const spec of specs) {
      const tip = tipByChain.get(spec.chainKey) ?? null;
      const seq = tip ? tip.seq + 1 : 0;
      const prevHash = tip ? tip.hash : spec.chainKey; // genesis chains off the chain key
      const hashed = await hashEvent(
        { chainKey: spec.chainKey, seq, eventType: spec.eventType, payload: spec.payload },
        prevHash,
      );
      insertEvent.run(
        `fixture-ev-${String(++n).padStart(3, "0")}`,
        spec.chainKey,
        seq,
        spec.eventType,
        "sag_aftra",
        spec.clauseRef,
        spec.licenceId,
        FIXTURE.talentId,
        null,
        spec.actorId,
        canonicalJson({}),
        canonicalJson(spec.payload),
        prevHash,
        hashed.hash,
        "203.0.113.44",
        "ImageVault-Bridge/2.1",
        spec.createdAt,
      );
      tipByChain.set(spec.chainKey, { seq, hash: hashed.hash });
    }

    // ── Report, and assert the fixture is actually usable ─────────────────────
    const events = db.prepare(`SELECT COUNT(*) c FROM compliance_events WHERE id LIKE 'fixture-%'`).get() as { c: number };
    const dls = db.prepare(`SELECT COUNT(*) c FROM download_events WHERE id LIKE 'fixture-%'`).get() as { c: number };

    // A record needs to be long enough to spill past one page, or the print
    // check cannot tell a working document from the truncation bug.
    const totalRows = 1 + fileIds.length + FIXTURE.licences.length * 2 + dls.c + events.c;
    expect(events.c).toBe(specs.length);
    expect(totalRows).toBeGreaterThan(60);

    console.log(
      `\nSeeded package ${FIXTURE.packageId}\n` +
        `  ${FIXTURE.licences.length} licences · ${fileIds.length} files · ${dls.c} downloads · ${events.c} ledger entries\n` +
        `  ~${totalRows} rows in the record\n` +
        `  talent: ${FIXTURE.talentId} (${FIXTURE.talentEmail})\n`,
    );

    db.close();
  });
});
