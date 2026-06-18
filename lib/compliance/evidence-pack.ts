// Claims evidence pack (Phase 8 §4.3) — the differentiator. An on-demand,
// machine-readable bundle for one production: the consent ledger, custody chain,
// download events and Bridge tamper log, plus a recomputed tamper-seal verification.
// This is the artifact an insurer hands to defense counsel (or feeds into actuarial
// ingest) when a likeness claim lands. The signed, printable HTML twin is produced
// by the existing certificate path (generateCertificate, scope = production); this
// module is the JSON sibling that also folds in the cyber-risk Bridge log.

import { eq, inArray } from "drizzle-orm";
import {
  bridgeEvents,
  bridgeGrants,
  downloadEvents,
  licences,
  organisations,
  productions,
} from "@/lib/db/schema";
import { evaluateScope, computeScopeTip } from "./certificate";
import { verifyChain } from "./ledger";
import type { RegimeId, ObligationResult, HashedEvent } from "./types";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface PackEvent {
  seq: number;
  eventType: string;
  clauseRef: string | null;
  createdAt: number;
  hash: string;
}

export interface PackLicence {
  licenceId: string;
  projectName: string | null;
  chainOk: boolean;
  eventCount: number;
  events: PackEvent[];
}

export interface PackDownload {
  id: string;
  licenceId: string | null;
  licenseeId: string;
  fileId: string;
  bytesTransferred: number | null;
  startedAt: number;
  completedAt: number | null;
}

export interface PackBridgeEvent {
  id: string;
  eventType: string;
  severity: string;
  packageId: string;
  deviceId: string;
  createdAt: number;
}

export interface EvidencePack {
  schema: "image-vault.claims-evidence-pack/1";
  generatedAt: number;
  regime: RegimeId;
  production: { id: string; name: string; type: string | null; orgName: string | null };
  verification: { ok: boolean; tipHash: string; brokenChains: string[] };
  obligations: ObligationResult[];
  licences: PackLicence[];
  downloadEvents: PackDownload[];
  bridgeTamperLog: PackBridgeEvent[];
  counts: {
    licences: number;
    ledgerEvents: number;
    downloads: number;
    bridgeEvents: number;
    requiredGaps: number;
  };
}

// Bridge events worth surfacing in a claims pack — the cyber-risk signal counsel
// and actuaries care about (integrity failures + access denials), not routine
// lifecycle chatter (heartbeats, enrolments).
const TAMPER_EVENT_TYPES = new Set([
  "tamper_detected",
  "unexpected_copy",
  "hash_mismatch",
  "re_access_denied",
  "open_denied",
  "purge_failed",
  "purge_stalled",
  "lease_expired",
]);

/**
 * Build the claims evidence pack for a production. Composes evaluateScope (the same
 * obligation + ledger evaluation the certificate uses, so the pack and the signed
 * certificate always agree) and recomputes the tamper seal per licence chain.
 * Returns null if the production does not exist.
 */
export async function buildEvidencePack(
  db: Db,
  productionId: string,
  regime: RegimeId,
): Promise<EvidencePack | null> {
  const prod = await db
    .select({
      id: productions.id,
      name: productions.name,
      type: productions.type,
      orgName: organisations.name,
    })
    .from(productions)
    .leftJoin(organisations, eq(productions.organisationId, organisations.id))
    .where(eq(productions.id, productionId))
    .get();
  if (!prod) return null;

  const { obligations, events, perLicence, licenceIds } = await evaluateScope(
    db,
    "production",
    productionId,
    regime,
  );

  // Group ledger events by their chain (one chain per licence) for per-licence
  // breakdown + integrity verification.
  const byChain = new Map<string, typeof events>();
  for (const e of events) {
    const list = byChain.get(e.chainKey) ?? [];
    list.push(e);
    byChain.set(e.chainKey, list);
  }

  const projectNames = licenceIds.length
    ? new Map(
        (
          await db
            .select({ id: licences.id, projectName: licences.projectName })
            .from(licences)
            .where(inArray(licences.id, licenceIds))
            .all()
        ).map((r) => [r.id, r.projectName]),
      )
    : new Map<string, string>();

  const brokenChains: string[] = [];
  const packLicences: PackLicence[] = [];
  for (const lid of licenceIds) {
    const chainKey = `licence:${lid}`;
    const chainEvents = byChain.get(chainKey) ?? [];
    const verification = await verifyChain(chainEvents as unknown as HashedEvent[]);
    const chainOk = verification.ok;
    if (!chainOk) brokenChains.push(lid);
    packLicences.push({
      licenceId: lid,
      projectName: projectNames.get(lid) ?? null,
      chainOk,
      eventCount: chainEvents.length,
      events: chainEvents.map((e) => ({
        seq: e.seq,
        eventType: e.eventType,
        clauseRef: e.clauseRef,
        createdAt: e.createdAt,
        hash: e.hash,
      })),
    });
  }

  // Downloads (custody / access log) for the production's licences.
  const downloads: PackDownload[] = licenceIds.length
    ? (
        await db
          .select({
            id: downloadEvents.id,
            licenceId: downloadEvents.licenceId,
            licenseeId: downloadEvents.licenseeId,
            fileId: downloadEvents.fileId,
            bytesTransferred: downloadEvents.bytesTransferred,
            startedAt: downloadEvents.startedAt,
            completedAt: downloadEvents.completedAt,
          })
          .from(downloadEvents)
          .where(inArray(downloadEvents.licenceId, licenceIds))
          .all()
      ).map((d) => ({ ...d }))
    : [];

  // Bridge tamper log: resolve the production's packages via its licences, then the
  // integrity-relevant Bridge events on those packages.
  const packageIds = licenceIds.length
    ? [
        ...new Set(
          (
            await db
              .select({ packageId: licences.packageId })
              .from(licences)
              .where(inArray(licences.id, licenceIds))
              .all()
          )
            .map((r) => r.packageId)
            .filter((p): p is string => !!p),
        ),
      ]
    : [];
  // Also pick up packages reachable through bridge grants on these licences.
  if (licenceIds.length) {
    const grantPkgs = await db
      .select({ packageId: bridgeGrants.packageId })
      .from(bridgeGrants)
      .where(inArray(bridgeGrants.licenceId, licenceIds))
      .all();
    for (const g of grantPkgs) if (g.packageId && !packageIds.includes(g.packageId)) packageIds.push(g.packageId);
  }

  const bridgeTamperLog: PackBridgeEvent[] = packageIds.length
    ? (
        await db
          .select({
            id: bridgeEvents.id,
            eventType: bridgeEvents.eventType,
            severity: bridgeEvents.severity,
            packageId: bridgeEvents.packageId,
            deviceId: bridgeEvents.deviceId,
            createdAt: bridgeEvents.createdAt,
          })
          .from(bridgeEvents)
          .where(inArray(bridgeEvents.packageId, packageIds))
          .all()
      )
        .filter((e) => e.severity === "critical" || TAMPER_EVENT_TYPES.has(e.eventType))
        .sort((a, b) => b.createdAt - a.createdAt)
    : [];

  const tipHash = await computeScopeTip(perLicence);
  const requiredGaps = obligations.filter((o) => o.status === "gap" && o.severity === "required").length;

  return {
    schema: "image-vault.claims-evidence-pack/1",
    generatedAt: Math.floor(Date.now() / 1000),
    regime,
    production: { id: prod.id, name: prod.name, type: prod.type, orgName: prod.orgName ?? null },
    verification: { ok: brokenChains.length === 0, tipHash, brokenChains },
    obligations,
    licences: packLicences,
    downloadEvents: downloads,
    bridgeTamperLog,
    counts: {
      licences: licenceIds.length,
      ledgerEvents: events.length,
      downloads: downloads.length,
      bridgeEvents: bridgeTamperLog.length,
      requiredGaps,
    },
  };
}
