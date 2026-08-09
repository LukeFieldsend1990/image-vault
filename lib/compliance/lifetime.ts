/**
 * Per-performer lifetime custody — one performer's whole likeness history,
 * across every production, in a single record.
 *
 * **Why this is not simply "render the talent chain".** The ledger's
 * `talent:{id}` chain has exactly one writer in the codebase (a
 * `data_controller.handover` event at signup, and only when the performer
 * claims a cast row that had a prior data controller). So a view built on that
 * chain alone would be blank for essentially every performer. Lifetime custody
 * is therefore assembled by fanning out over the performer's licence chains —
 * where the real consent, custody and enforcement events live — and folding in
 * the operational record: file releases and live vendor grants.
 *
 * The talent chain is still included, because when it does carry an event that
 * event is a controller handover, which is exactly the kind of thing this view
 * exists to show.
 *
 * Integrity is recomputed at read time via `verifyChainSet`, the same routine
 * behind the printed custody record and the public verification page — so a
 * broken chain surfaces here too rather than only on the document.
 */

import { desc, eq, inArray } from "drizzle-orm";
import {
  bridgeGrants,
  downloadEvents,
  licences,
  scanFiles,
  scanPackages,
  talentProfiles,
  users,
} from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { licenceChain, talentChain } from "./ledger";
import { loadChainEvents, verifyChainSet, type ChainStatus } from "./seal";
import { ledgerEventLabel, ledgerSeverity, type LedgerSeverity } from "./labels";

type Db = ReturnType<typeof getDb>;

export interface LifetimeLedgerEvent {
  id: string;
  chainKey: string;
  seq: number;
  hash: string;
  eventType: string;
  label: string;
  severity: LedgerSeverity;
  clauseRef: string | null;
  licenceId: string | null;
  createdAt: number;
}

export interface LifetimeLicence {
  id: string;
  shortCode: string | null;
  projectName: string;
  productionCompany: string;
  status: string;
  validFrom: number;
  validTo: number;
  revokedAt: number | null;
  packageId: string | null;
  packageName: string | null;
  licenseeEmail: string | null;
  /** Ledger entries on this licence's chain, newest first. */
  events: LifetimeLedgerEvent[];
  /** Recorded file releases under this licence. */
  releaseCount: number;
  /** Vendor grants that are live right now. */
  liveGrantCount: number;
  chainOk: boolean;
}

export interface LifetimeProduction {
  productionCompany: string;
  projectName: string;
  licences: LifetimeLicence[];
}

export interface LifetimeCustody {
  talentId: string;
  talentName: string | null;
  talentEmail: string | null;

  productions: LifetimeProduction[];
  /** Talent-chain entries — controller handovers and anything else platform-scoped. */
  platformEvents: LifetimeLedgerEvent[];

  summary: {
    productions: number;
    licences: number;
    activeLicences: number;
    packages: number;
    ledgerEntries: number;
    releases: number;
    liveGrants: number;
    firstActivity: number | null;
    lastActivity: number | null;
  };

  chains: ChainStatus[];
  /** SHA-256 over every chain tip in scope. */
  recordHash: string;
  chainsOk: boolean;
  chainBreak: string | null;

  generatedAt: number;
}

const LIVE_LICENCE_STATUSES = new Set(["APPROVED", "SCRUB_PERIOD", "OVERDUE"]);

export async function buildLifetimeCustody(db: Db, talentId: string): Promise<LifetimeCustody> {
  const now = Math.floor(Date.now() / 1000);

  const [profile, account, licenceRows, packageRows] = await Promise.all([
    db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, talentId)).get(),
    db.select({ email: users.email }).from(users).where(eq(users.id, talentId)).get(),
    db
      .select({
        id: licences.id,
        shortCode: licences.shortCode,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        status: licences.status,
        validFrom: licences.validFrom,
        validTo: licences.validTo,
        revokedAt: licences.revokedAt,
        packageId: licences.packageId,
        licenseeId: licences.licenseeId,
        createdAt: licences.createdAt,
      })
      .from(licences)
      .where(eq(licences.talentId, talentId))
      .orderBy(desc(licences.createdAt))
      .all(),
    db.select({ id: scanPackages.id, name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.talentId, talentId)).all(),
  ]);

  const packageNameById = new Map(packageRows.map((p) => [p.id, p.name]));

  // ── Ledger ────────────────────────────────────────────────────────────────
  const chainKeys = [...licenceRows.map((l) => licenceChain(l.id)), talentChain(talentId)];
  const [eventsByChain, verification] = await Promise.all([
    loadChainEvents(db, chainKeys),
    verifyChainSet(db, chainKeys),
  ]);

  const decorate = (chainKey: string): LifetimeLedgerEvent[] =>
    (eventsByChain.get(chainKey) ?? [])
      .map((e) => ({
        id: e.id,
        chainKey: e.chainKey,
        seq: e.seq,
        hash: e.hash,
        eventType: e.eventType,
        label: ledgerEventLabel(e.eventType),
        severity: ledgerSeverity(e.eventType),
        clauseRef: e.clauseRef,
        licenceId: e.licenceId,
        createdAt: e.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);

  const chainOkByKey = new Map(verification.chains.map((c) => [c.chainKey, c.ok]));

  // ── Operational record ────────────────────────────────────────────────────
  // Releases are counted per licence. A talent's own downloads carry a null
  // licenceId and are deliberately excluded here — this view is about who else
  // has held the data.
  const licenceIds = licenceRows.map((l) => l.id);
  const releasesByLicence = new Map<string, number>();
  const liveGrantsByLicence = new Map<string, number>();
  const licenseeEmailById = new Map<string, string>();

  if (licenceIds.length > 0) {
    const packageIds = packageRows.map((p) => p.id);

    const [releaseRows, grantRows, licenseeRows] = await Promise.all([
      packageIds.length
        ? db
            .select({ licenceId: downloadEvents.licenceId, startedAt: downloadEvents.startedAt })
            .from(downloadEvents)
            .innerJoin(scanFiles, eq(scanFiles.id, downloadEvents.fileId))
            .where(inArray(scanFiles.packageId, packageIds))
            .all()
        : Promise.resolve([] as { licenceId: string | null; startedAt: number }[]),
      db
        .select({
          licenceId: bridgeGrants.licenceId,
          deviceId: bridgeGrants.deviceId,
          expiresAt: bridgeGrants.expiresAt,
          revokedAt: bridgeGrants.revokedAt,
        })
        .from(bridgeGrants)
        .where(inArray(bridgeGrants.licenceId, licenceIds))
        .all(),
      db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, [...new Set(licenceRows.map((l) => l.licenseeId))]))
        .all(),
    ]);

    for (const r of releaseRows) {
      if (!r.licenceId) continue;
      releasesByLicence.set(r.licenceId, (releasesByLicence.get(r.licenceId) ?? 0) + 1);
    }

    // A bridge reopening the same licence on the same device supersedes rather
    // than adds, so dedupe by (licence, device) or one vendor looks like many.
    const seenGrants = new Set<string>();
    for (const g of grantRows) {
      if (g.revokedAt != null || g.expiresAt <= now) continue;
      const key = `${g.licenceId}::${g.deviceId ?? ""}`;
      if (seenGrants.has(key)) continue;
      seenGrants.add(key);
      liveGrantsByLicence.set(g.licenceId, (liveGrantsByLicence.get(g.licenceId) ?? 0) + 1);
    }

    for (const u of licenseeRows) licenseeEmailById.set(u.id, u.email);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const built: LifetimeLicence[] = licenceRows.map((l) => {
    const key = licenceChain(l.id);
    return {
      id: l.id,
      shortCode: l.shortCode,
      projectName: l.projectName,
      productionCompany: l.productionCompany,
      status: l.status,
      validFrom: l.validFrom,
      validTo: l.validTo,
      revokedAt: l.revokedAt,
      packageId: l.packageId,
      packageName: l.packageId ? (packageNameById.get(l.packageId) ?? null) : null,
      licenseeEmail: licenseeEmailById.get(l.licenseeId) ?? null,
      events: decorate(key),
      releaseCount: releasesByLicence.get(l.id) ?? 0,
      liveGrantCount: liveGrantsByLicence.get(l.id) ?? 0,
      chainOk: chainOkByKey.get(key) ?? true,
    };
  });

  // Group by production. Company plus project, because the same company runs
  // several productions and the same title can recur across companies.
  const groups = new Map<string, LifetimeProduction>();
  for (const l of built) {
    const key = `${l.productionCompany}::${l.projectName}`;
    const existing = groups.get(key);
    if (existing) existing.licences.push(l);
    else groups.set(key, { productionCompany: l.productionCompany, projectName: l.projectName, licences: [l] });
  }

  const platformEvents = decorate(talentChain(talentId));

  const allTimestamps = [
    ...built.flatMap((l) => l.events.map((e) => e.createdAt)),
    ...platformEvents.map((e) => e.createdAt),
  ];

  const productions = [...groups.values()].sort((a, b) => {
    const aLatest = Math.max(...a.licences.map((l) => l.validFrom), 0);
    const bLatest = Math.max(...b.licences.map((l) => l.validFrom), 0);
    return bLatest - aLatest;
  });

  return {
    talentId,
    talentName: profile?.fullName ?? null,
    talentEmail: account?.email ?? null,

    productions,
    platformEvents,

    summary: {
      productions: productions.length,
      licences: built.length,
      activeLicences: built.filter((l) => LIVE_LICENCE_STATUSES.has(l.status) && l.revokedAt == null).length,
      packages: packageRows.length,
      ledgerEntries: verification.eventCount,
      releases: [...releasesByLicence.values()].reduce((a, b) => a + b, 0),
      liveGrants: [...liveGrantsByLicence.values()].reduce((a, b) => a + b, 0),
      firstActivity: allTimestamps.length ? Math.min(...allTimestamps) : null,
      lastActivity: allTimestamps.length ? Math.max(...allTimestamps) : null,
    },

    chains: verification.chains,
    recordHash: verification.setHash,
    chainsOk: verification.ok,
    chainBreak: verification.firstBreak
      ? `${verification.firstBreak.chainKey} failed at entry ${verification.firstBreak.brokenAtSeq ?? "?"}: ${
          verification.firstBreak.reason ?? "content altered"
        }`
      : null,

    generatedAt: now,
  };
}
