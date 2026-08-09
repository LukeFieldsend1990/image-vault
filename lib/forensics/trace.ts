/**
 * Leak trace-back — "I found this file in the wild. Where did it come from?"
 *
 * The chain of custody says what we released. This answers the inverse: given an
 * artifact recovered from somewhere else, identify which scan it is and who was
 * given it. That turns the record from a filing cabinet into an enforcement
 * tool, which is the thing an agent or a union actually wants from it.
 *
 * Two independent routes in, because a leaked file arrives in one of two states:
 *
 *  1. **Byte-identical** — someone forwarded the file unchanged. Its SHA-256
 *     matches `scan_files.sha256` exactly. Cheap, certain, and the common case
 *     for a careless leak.
 *
 *  2. **Watermarked derivative** — the bytes have changed, but the geometry
 *     watermark survives. Running the existing detector against the suspect file
 *     recovers the fingerprint bits; those bits are unique per
 *     (file, licence, licensee), so matching them names the recipient directly.
 *     This is the route that still works when the file has been re-exported.
 *
 * Both converge on the same answer shape: the file, the releases of it on
 * record, and — for a fingerprint match — the single licensee the watermark
 * identifies.
 *
 * What this deliberately does NOT do is claim more than the evidence supports.
 * A hash match proves the bytes are ours; it does not by itself prove *who*
 * leaked them, because a file may have been released to several licensees.
 * Every result carries that distinction explicitly in `attribution`.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  downloadEvents,
  geometryFingerprints,
  licences,
  scanFiles,
  scanPackages,
  talentProfiles,
  users,
} from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface TraceRelease {
  downloadEventId: string;
  licenceId: string | null;
  /** Null on a talent's own download of their own package. */
  projectName: string | null;
  productionCompany: string | null;
  recipientEmail: string;
  /** True when this was the performer downloading their own file. */
  selfDownload: boolean;
  ip: string | null;
  userAgent: string | null;
  bytesTransferred: number | null;
  startedAt: number;
  completedAt: number | null;
}

export interface TraceFile {
  fileId: string;
  filename: string;
  sizeBytes: number;
  sha256: string | null;
  packageId: string;
  packageName: string;
  talentId: string;
  talentName: string | null;
  talentEmail: string | null;
}

export interface TraceMatch {
  /** How the suspect artifact was matched back to a file we hold. */
  matchedBy: "sha256" | "fingerprint";
  file: TraceFile;
  /**
   * What the match supports.
   *  - "recipient"  a watermark unique to one licensee — names who received it
   *  - "file"       the bytes are ours, but any recipient of this file could be the source
   */
  attribution: "recipient" | "file";
  /** Set only on a fingerprint match: the licensee the watermark identifies. */
  identifiedRecipient: {
    licenceId: string;
    licenseeId: string;
    licenseeEmail: string | null;
    projectName: string | null;
    productionCompany: string | null;
    fingerprintId: string;
    issuedAt: number;
  } | null;
  /** Every recorded release of this file, newest first. */
  releases: TraceRelease[];
}

export interface TraceResult {
  query: string;
  queryKind: "sha256" | "fingerprint" | "unrecognised";
  matches: TraceMatch[];
  /** Plain-English summary of what the result does and does not establish. */
  conclusion: string;
}

// ── Input classification ─────────────────────────────────────────────────────

const SHA256_RE = /^[0-9a-f]{64}$/i;
/** Fingerprint bits are stored as hex; 128-bit is the default, so 32 hex chars. */
const FINGERPRINT_RE = /^[0-9a-f]{16,64}$/i;

export function classifyQuery(raw: string): "sha256" | "fingerprint" | "unrecognised" {
  const q = raw.trim().replace(/\s+/g, "").toLowerCase();
  if (SHA256_RE.test(q)) return "sha256";
  if (FINGERPRINT_RE.test(q)) return "fingerprint";
  return "unrecognised";
}

function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

// ── Shared loaders ───────────────────────────────────────────────────────────

async function loadFiles(db: Db, fileIds: string[]): Promise<Map<string, TraceFile>> {
  const out = new Map<string, TraceFile>();
  if (fileIds.length === 0) return out;

  const rows = await db
    .select({
      fileId: scanFiles.id,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      sha256: scanFiles.sha256,
      packageId: scanFiles.packageId,
      packageName: scanPackages.name,
      talentId: scanPackages.talentId,
    })
    .from(scanFiles)
    .innerJoin(scanPackages, eq(scanPackages.id, scanFiles.packageId))
    .where(inArray(scanFiles.id, fileIds))
    .all();

  const talentIds = [...new Set(rows.map((r) => r.talentId))];
  const [profiles, accounts] = await Promise.all([
    talentIds.length
      ? db
          .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
          .from(talentProfiles)
          .where(inArray(talentProfiles.userId, talentIds))
          .all()
      : Promise.resolve([] as { userId: string; fullName: string | null }[]),
    talentIds.length
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, talentIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
  ]);
  const nameById = new Map(profiles.map((p) => [p.userId, p.fullName]));
  const emailById = new Map(accounts.map((a) => [a.id, a.email]));

  for (const r of rows) {
    out.set(r.fileId, {
      fileId: r.fileId,
      filename: r.filename,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      packageId: r.packageId,
      packageName: r.packageName,
      talentId: r.talentId,
      talentName: nameById.get(r.talentId) ?? null,
      talentEmail: emailById.get(r.talentId) ?? null,
    });
  }
  return out;
}

/**
 * Every recorded release of a file. `licenceId` null means the performer
 * downloading their own scan, which is flagged rather than hidden — it is a real
 * release path and an investigator should see it.
 */
async function loadReleases(db: Db, fileId: string, ownerTalentId: string): Promise<TraceRelease[]> {
  const rows = await db
    .select({
      id: downloadEvents.id,
      licenceId: downloadEvents.licenceId,
      licenseeId: downloadEvents.licenseeId,
      ip: downloadEvents.ip,
      userAgent: downloadEvents.userAgent,
      bytesTransferred: downloadEvents.bytesTransferred,
      startedAt: downloadEvents.startedAt,
      completedAt: downloadEvents.completedAt,
    })
    .from(downloadEvents)
    .where(eq(downloadEvents.fileId, fileId))
    .orderBy(desc(downloadEvents.startedAt))
    .all();

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.licenseeId))];
  const licenceIds = [...new Set(rows.map((r) => r.licenceId).filter((v): v is string => Boolean(v)))];

  const [accounts, lics] = await Promise.all([
    db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds)).all(),
    licenceIds.length
      ? db
          .select({
            id: licences.id,
            projectName: licences.projectName,
            productionCompany: licences.productionCompany,
          })
          .from(licences)
          .where(inArray(licences.id, licenceIds))
          .all()
      : Promise.resolve([] as { id: string; projectName: string; productionCompany: string }[]),
  ]);
  const emailById = new Map(accounts.map((a) => [a.id, a.email]));
  const licById = new Map(lics.map((l) => [l.id, l]));

  return rows.map((r) => {
    const lic = r.licenceId ? licById.get(r.licenceId) : undefined;
    return {
      downloadEventId: r.id,
      licenceId: r.licenceId,
      projectName: lic?.projectName ?? null,
      productionCompany: lic?.productionCompany ?? null,
      recipientEmail: emailById.get(r.licenseeId) ?? "unknown",
      selfDownload: r.licenceId === null && r.licenseeId === ownerTalentId,
      ip: r.ip,
      userAgent: r.userAgent,
      bytesTransferred: r.bytesTransferred,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    };
  });
}

// ── Trace by content hash ────────────────────────────────────────────────────

/**
 * Match a suspect file by SHA-256 of its bytes.
 *
 * Establishes that the file is one of ours and lists everyone it was released
 * to. It does **not** identify which of them leaked it — a file released to
 * four licensees has four candidate sources. Use the watermark route for
 * attribution.
 */
export async function traceByFileHash(db: Db, sha256: string): Promise<TraceMatch[]> {
  const q = normalise(sha256);
  const files = await db
    .select({ id: scanFiles.id })
    .from(scanFiles)
    .where(eq(scanFiles.sha256, q))
    .all();
  if (files.length === 0) return [];

  const fileMap = await loadFiles(db, files.map((f) => f.id));
  const matches: TraceMatch[] = [];

  for (const file of fileMap.values()) {
    matches.push({
      matchedBy: "sha256",
      file,
      attribution: "file",
      identifiedRecipient: null,
      releases: await loadReleases(db, file.fileId, file.talentId),
    });
  }
  return matches;
}

// ── Trace by watermark fingerprint ───────────────────────────────────────────

/**
 * Match recovered watermark bits (or a fingerprint payload hash) back to the
 * exact issuance.
 *
 * The bits are an HMAC over {fileId, licenceId, licenseeId, packageId}, so a
 * match is unique to one recipient — this is the route that supports naming a
 * source rather than a list of candidates. A prefix is accepted because a
 * detector may recover only part of the payload from a damaged file.
 */
export async function traceByFingerprint(db: Db, bitsHexOrHash: string): Promise<TraceMatch[]> {
  const q = normalise(bitsHexOrHash);

  // Exact matches on either stored representation first.
  let rows = await db
    .select({
      id: geometryFingerprints.id,
      fileId: geometryFingerprints.fileId,
      licenceId: geometryFingerprints.licenceId,
      licenseeId: geometryFingerprints.licenseeId,
      fingerprintBits: geometryFingerprints.fingerprintBits,
      createdAt: geometryFingerprints.createdAt,
    })
    .from(geometryFingerprints)
    .where(and(eq(geometryFingerprints.fingerprintBits, q), eq(geometryFingerprints.status, "ready")))
    .all();

  if (rows.length === 0) {
    rows = await db
      .select({
        id: geometryFingerprints.id,
        fileId: geometryFingerprints.fileId,
        licenceId: geometryFingerprints.licenceId,
        licenseeId: geometryFingerprints.licenseeId,
        fingerprintBits: geometryFingerprints.fingerprintBits,
        createdAt: geometryFingerprints.createdAt,
      })
      .from(geometryFingerprints)
      .where(
        and(eq(geometryFingerprints.fingerprintPayloadHash, q), eq(geometryFingerprints.status, "ready")),
      )
      .all();
  }

  // Partial recovery: a detector that only resolved some of the payload gives a
  // prefix. Matched in-process rather than with a LIKE so the query stays
  // parameterised and the prefix cannot be read as a pattern.
  if (rows.length === 0 && q.length >= 16) {
    const all = await db
      .select({
        id: geometryFingerprints.id,
        fileId: geometryFingerprints.fileId,
        licenceId: geometryFingerprints.licenceId,
        licenseeId: geometryFingerprints.licenseeId,
        fingerprintBits: geometryFingerprints.fingerprintBits,
        createdAt: geometryFingerprints.createdAt,
      })
      .from(geometryFingerprints)
      .where(eq(geometryFingerprints.status, "ready"))
      .all();
    rows = all.filter((r) => r.fingerprintBits.toLowerCase().startsWith(q));
  }

  if (rows.length === 0) return [];

  const fileMap = await loadFiles(db, [...new Set(rows.map((r) => r.fileId))]);
  const licIds = [...new Set(rows.map((r) => r.licenceId))];
  const userIds = [...new Set(rows.map((r) => r.licenseeId))];

  const [lics, accounts] = await Promise.all([
    licIds.length
      ? db
          .select({
            id: licences.id,
            projectName: licences.projectName,
            productionCompany: licences.productionCompany,
          })
          .from(licences)
          .where(inArray(licences.id, licIds))
          .all()
      : Promise.resolve([] as { id: string; projectName: string; productionCompany: string }[]),
    userIds.length
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
  ]);
  const licById = new Map(lics.map((l) => [l.id, l]));
  const emailById = new Map(accounts.map((a) => [a.id, a.email]));

  const matches: TraceMatch[] = [];
  for (const r of rows) {
    const file = fileMap.get(r.fileId);
    if (!file) continue; // file deleted since issuance — nothing to attribute to
    const lic = licById.get(r.licenceId);
    matches.push({
      matchedBy: "fingerprint",
      file,
      attribution: "recipient",
      identifiedRecipient: {
        licenceId: r.licenceId,
        licenseeId: r.licenseeId,
        licenseeEmail: emailById.get(r.licenseeId) ?? null,
        projectName: lic?.projectName ?? null,
        productionCompany: lic?.productionCompany ?? null,
        fingerprintId: r.id,
        issuedAt: r.createdAt,
      },
      releases: await loadReleases(db, file.fileId, file.talentId),
    });
  }
  return matches;
}

// ── Entry point ──────────────────────────────────────────────────────────────

function buildConclusion(kind: TraceResult["queryKind"], matches: TraceMatch[]): string {
  if (kind === "unrecognised") {
    return "That does not look like a SHA-256 digest or a watermark fingerprint. Paste a 64-character file hash, or the hex payload recovered by the watermark detector.";
  }
  if (matches.length === 0) {
    return kind === "sha256"
      ? "No file held on the platform has that hash. Either the bytes were altered after release — try the watermark route — or the file did not come from here."
      : "No issued watermark matches that payload. It may have been recovered incorrectly, or the file was released before watermarking was enabled.";
  }

  const m = matches[0];
  if (m.attribution === "recipient" && m.identifiedRecipient) {
    const who = m.identifiedRecipient.licenseeEmail ?? "an identified licensee";
    const where = m.identifiedRecipient.productionCompany
      ? ` (${m.identifiedRecipient.productionCompany})`
      : "";
    return `The watermark in this artifact is unique to the copy issued to ${who}${where}. It identifies the recipient of that copy — not necessarily the person who published it, since a recipient may themselves have been breached.`;
  }

  const count = m.releases.length;
  if (count === 0) {
    return "The bytes match a file held on the platform, but no release of it is on record. If the file left the platform, it did so by a route that is not logged — worth investigating on its own.";
  }
  if (count === 1) {
    return `The bytes are byte-identical to a file held on the platform, and it was released exactly once. That single release is the only recorded route out — but a hash match alone does not prove who published it.`;
  }
  return `The bytes are byte-identical to a file held on the platform, which was released ${count} times. Any of those recipients could be the source; a hash match does not distinguish between them. If the file carries a geometry watermark, run the detector to narrow it to one.`;
}

/** Classify the input and route it to the right matcher. */
export async function trace(db: Db, query: string): Promise<TraceResult> {
  const kind = classifyQuery(query);
  const q = normalise(query);

  let matches: TraceMatch[] = [];
  if (kind === "sha256") {
    matches = await traceByFileHash(db, q);
    // A 64-char hex string is a valid fingerprint payload hash too, so fall
    // through rather than reporting "not found" on a legitimate watermark.
    if (matches.length === 0) matches = await traceByFingerprint(db, q);
  } else if (kind === "fingerprint") {
    matches = await traceByFingerprint(db, q);
  }

  return { query: q, queryKind: kind, matches, conclusion: buildConclusion(kind, matches) };
}
