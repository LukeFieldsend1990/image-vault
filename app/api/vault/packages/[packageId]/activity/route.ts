import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, licences, downloadEvents, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { formatChainCode } from "@/lib/codes/codes";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { licenceChain, talentChain } from "@/lib/compliance/ledger";
import { getOrMintSeal, loadChainEvents, verifyChainSet } from "@/lib/compliance/seal";
import { eq, inArray, sql } from "drizzle-orm";

export type CustodyEventType =
  | "package_created"
  | "file_added"
  | "licence_requested"
  | "licence_approved"
  | "licence_denied"
  | "licence_revoked"
  | "file_downloaded"
  | "talent_downloaded"
  | "compliance_event";

export interface CustodyEvent {
  type: CustodyEventType;
  at: number; // unix timestamp
  // package_created
  actor?: string;
  // file_added
  filename?: string;
  sizeBytes?: number;
  // licence events
  licenceId?: string;
  projectName?: string;
  productionCompany?: string;
  licensee?: string;
  intendedUse?: string;
  validFrom?: number;
  validTo?: number;
  approvedBy?: string;
  deniedReason?: string | null;
  // file_downloaded
  bytesTransferred?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  completedAt?: number | null;
  // compliance_event (hash-chained ledger: consent, custody legs, attestations, transfers…)
  complianceEventType?: string;
  clauseRef?: string | null;
  // Ledger position. Present only on `compliance_event` — these are what make
  // the record a chain rather than a list, and the document renders them.
  chainKey?: string;
  seq?: number;
  hash?: string;
  prevHash?: string;
}

export interface CustodyPackage {
  id: string;
  name: string;
  captureDate: number | null;
  studioName: string | null;
  talentEmail: string;
  talentName: string | null;
  createdAt: number;
  chainCode: string;
}

/** One file under custody, with the fingerprint of the bytes actually stored. */
export interface CustodyFile {
  filename: string;
  sizeBytes: number;
  sha256: string | null;
  completedAt: number | null;
}

/** Per-chain integrity result, shown in the record's tamper seal. */
export interface CustodyChain {
  chainKey: string;
  eventCount: number;
  tipHash: string;
  ok: boolean;
  brokenAtSeq?: number;
  reason?: string;
}

export interface ActivityResponse {
  package: CustodyPackage;
  events: CustodyEvent[];
  files: CustodyFile[];
  chains: CustodyChain[];
  /** SHA-256 over every chain tip in scope — the record's tamper seal. */
  recordHash: string;
  /** False when any chain failed verification. */
  chainsOk: boolean;
  /** Human line naming the first break, when there is one. */
  chainBreak: string | null;
  /** Opaque ref for the public verification page (/verify/{ref}). */
  sealRef: string;
  /** Absolute verification URL, printed on the document and encoded in its QR. */
  verifyUrl: string;
  generatedAt: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      name: scanPackages.name,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      createdAt: scanPackages.createdAt,
      scanNumber: scanPackages.scanNumber,
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  const admin = isAdmin(session.email);

  if (!isOwner && !isRep && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch all raw data ──────────────────────────────────────────────────────

  const [talentUser, talentProfile, files, licenceRows] = await Promise.all([
    db.select({ email: users.email, shortCode: users.shortCode }).from(users).where(eq(users.id, pkg.talentId)).get(),
    db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, pkg.talentId)).get(),
    db.select({
      id: scanFiles.id,
      packageId: scanFiles.packageId,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      sha256: scanFiles.sha256,
      createdAt: scanFiles.createdAt,
      completedAt: scanFiles.completedAt,
    }).from(scanFiles).where(eq(scanFiles.packageId, packageId)).all(),
    db.select({
      id: licences.id,
      licenseeId: licences.licenseeId,
      approvedBy: licences.approvedBy,
      createdAt: licences.createdAt,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      approvedAt: licences.approvedAt,
      deniedAt: licences.deniedAt,
      deniedReason: licences.deniedReason,
      revokedAt: licences.revokedAt,
    }).from(licences).where(eq(licences.packageId, packageId)).all(),
  ]);

  // Hash-chained compliance-ledger events for every chain touching this package
  // — consent grants/withdrawals, dual-custody legs, attestations, transfers.
  // These live in the append-only ledger, not on the licence columns, so the
  // chain-of-custody document would otherwise omit them entirely.
  //
  // The talent chain is included alongside the licence chains: talent-scoped
  // events (strikes, platform-level attestations) are part of this package's
  // custody story and used to be dropped from the record entirely.
  const chainKeys = [...licenceRows.map((l) => licenceChain(l.id)), talentChain(pkg.talentId)];
  const eventsByChain = await loadChainEvents(db, chainKeys);
  const ledgerEvents = [...eventsByChain.values()].flat();

  // Re-run the hash chain now, at read time, rather than trusting a stored flag.
  // This is what the record's tamper seal attests to.
  const verification = await verifyChainSet(db, chainKeys);

  // Collect all user IDs we need emails for
  const userIdSet = new Set<string>();
  for (const l of licenceRows) {
    userIdSet.add(l.licenseeId);
    if (l.approvedBy) userIdSet.add(l.approvedBy);
  }
  for (const e of ledgerEvents) {
    if (e.actorId) userIdSet.add(e.actorId);
  }

  let dlEvents: {
    fileId: string;
    licenseeId: string;
    licenceId: string | null;
    startedAt: number;
    bytesTransferred: number | null;
    ip: string | null;
    userAgent: string | null;
    completedAt: number | null;
  }[] = [];
  const fileIds = files.map((f) => f.id);
  if (fileIds.length > 0) {
    // Use a subquery instead of inArray to avoid D1's bound-parameter limit
    // (packages with hundreds of files would exceed the 100-parameter cap)
    dlEvents = await db
      .select({
        fileId: downloadEvents.fileId,
        licenseeId: downloadEvents.licenseeId,
        licenceId: downloadEvents.licenceId,
        startedAt: downloadEvents.startedAt,
        bytesTransferred: downloadEvents.bytesTransferred,
        ip: downloadEvents.ip,
        userAgent: downloadEvents.userAgent,
        completedAt: downloadEvents.completedAt,
      })
      .from(downloadEvents)
      .where(sql`${downloadEvents.fileId} IN (SELECT id FROM scan_files WHERE package_id = ${packageId})`)
      .all();
    for (const dl of dlEvents) userIdSet.add(dl.licenseeId);
  }

  // Fetch all user emails in one query
  const userMap = new Map<string, string>();
  const userIds = Array.from(userIdSet);
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds))
      .all();
    for (const u of userRows) userMap.set(u.id, u.email);
  }

  // ── Build event list ────────────────────────────────────────────────────────

  const events: CustodyEvent[] = [];

  // Package created
  events.push({
    type: "package_created",
    at: pkg.createdAt,
    actor: talentUser?.email ?? "Unknown",
  });

  // Files added
  for (const f of files) {
    events.push({
      type: "file_added",
      at: f.createdAt,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
    });
  }

  // Licence events
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));
  const fileMap = new Map(files.map((f) => [f.id, f]));

  for (const l of licenceRows) {
    const licenseeEmail = userMap.get(l.licenseeId) ?? "Unknown";
    const approvedByEmail = l.approvedBy ? (userMap.get(l.approvedBy) ?? "Unknown") : undefined;

    events.push({
      type: "licence_requested",
      at: l.createdAt,
      licenceId: l.id,
      projectName: l.projectName,
      productionCompany: l.productionCompany,
      licensee: licenseeEmail,
      intendedUse: l.intendedUse,
      validFrom: l.validFrom,
      validTo: l.validTo,
    });

    if (l.approvedAt) {
      events.push({
        type: "licence_approved",
        at: l.approvedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
        approvedBy: approvedByEmail,
      });
    }

    if (l.deniedAt) {
      events.push({
        type: "licence_denied",
        at: l.deniedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
        deniedReason: l.deniedReason,
      });
    }

    if (l.revokedAt) {
      events.push({
        type: "licence_revoked",
        at: l.revokedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
      });
    }
  }

  // Download events — split by whether it was a licensee or talent's own download
  for (const dl of dlEvents) {
    const file = fileMap.get(dl.fileId);
    const actorEmail = userMap.get(dl.licenseeId) ?? "Unknown";

    if (dl.licenceId) {
      // Licensee dual-custody download
      const licence = licenceMap.get(dl.licenceId);
      events.push({
        type: "file_downloaded",
        at: dl.startedAt,
        licenceId: dl.licenceId,
        projectName: licence?.projectName,
        productionCompany: licence?.productionCompany,
        licensee: actorEmail,
        filename: file?.filename,
        sizeBytes: file?.sizeBytes,
        bytesTransferred: dl.bytesTransferred,
        ip: dl.ip,
        userAgent: dl.userAgent,
        completedAt: dl.completedAt,
      });
    } else {
      // Talent's own direct download
      events.push({
        type: "talent_downloaded",
        at: dl.startedAt,
        actor: actorEmail,
        filename: file?.filename,
        sizeBytes: file?.sizeBytes,
        bytesTransferred: dl.bytesTransferred,
        ip: dl.ip,
        userAgent: dl.userAgent,
        completedAt: dl.completedAt,
      });
    }
  }

  // Compliance-ledger events (durable, hash-chained)
  for (const e of ledgerEvents) {
    const licence = e.licenceId ? licenceMap.get(e.licenceId) : undefined;
    events.push({
      type: "compliance_event",
      at: e.createdAt,
      complianceEventType: e.eventType,
      clauseRef: e.clauseRef,
      licenceId: e.licenceId ?? undefined,
      projectName: licence?.projectName,
      productionCompany: licence?.productionCompany,
      actor: e.actorId ? (userMap.get(e.actorId) ?? "Unknown") : undefined,
      ip: e.ipAddress,
      userAgent: e.userAgent,
      chainKey: e.chainKey,
      seq: e.seq,
      hash: e.hash,
      prevHash: e.prevHash,
    });
  }

  // Sort chronologically. Ties break on ledger seq so two events recorded in the
  // same second still read in the order they were chained.
  events.sort((a, b) => a.at - b.at || (a.seq ?? -1) - (b.seq ?? -1));

  const talentName = talentProfile?.fullName ?? null;

  // The seal is what makes the printed record checkable by someone who does not
  // have an account. `subjectLabel` is shown on the PUBLIC page, so it carries
  // initials and the vault code only — never the performer's name or email.
  const chainCode = formatChainCode({ actorCode: talentUser?.shortCode, scanNumber: pkg.scanNumber });
  const seal = await getOrMintSeal(db, {
    kind: "custody_record",
    subjectType: "package",
    subjectId: pkg.id,
    subjectLabel: `${initials(talentName)} · ${chainCode}`,
    chainKeys,
    issuedBy: session.sub,
  });

  const response: ActivityResponse = {
    package: {
      id: pkg.id,
      name: pkg.name,
      captureDate: pkg.captureDate ?? null,
      studioName: pkg.studioName ?? null,
      talentEmail: talentUser?.email ?? "Unknown",
      talentName,
      createdAt: pkg.createdAt,
      chainCode,
    },
    events,
    files: files
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((f) => ({
        filename: f.filename,
        sizeBytes: f.sizeBytes,
        sha256: f.sha256,
        completedAt: f.completedAt,
      })),
    chains: verification.chains.map((c) => ({
      chainKey: c.chainKey,
      eventCount: c.eventCount,
      tipHash: c.tipHash,
      ok: c.ok,
      brokenAtSeq: c.brokenAtSeq,
      reason: c.reason,
    })),
    recordHash: verification.setHash,
    chainsOk: verification.ok,
    chainBreak: verification.firstBreak
      ? `${verification.firstBreak.chainKey} failed at entry ${verification.firstBreak.brokenAtSeq ?? "?"}: ${
          verification.firstBreak.reason ?? "content altered"
        }`
      : null,
    sealRef: seal.ref,
    // Built server-side from the canonical host, not the browser's origin — a
    // printed document must carry the address that works for whoever holds it.
    verifyUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai"}/verify/${seal.ref}`,
    generatedAt: Math.floor(Date.now() / 1000),
  };

  return NextResponse.json(response);
}

/** Initials only — the public verification page must not disclose the name. */
function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 3)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
