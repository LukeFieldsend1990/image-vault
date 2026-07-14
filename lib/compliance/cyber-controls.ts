// Cyber-underwriting controls (Phase 8 §4.6) — a SOC2-lite control view for cyber
// underwriters. It reframes the biometric-isolation (Article 39.E) and security-
// custody (39.H) attestations ImageVault already records, plus the Bridge device-
// integrity log, as a small set of pass/partial/fail controls. This is what a cyber
// underwriter checks before binding the BIPA / biometric-breach exposure.

import { inArray } from "drizzle-orm";
import { bridgeEvents, bridgeGrants, licences } from "@/lib/db/schema";
import { evaluateScope } from "./certificate";
import type { RegimeId } from "./types";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export type ControlStatus = "met" | "partial" | "gap" | "n/a";

export interface CyberControl {
  key: string;
  title: string;
  clauseRef: string | null;
  status: ControlStatus;
  detail: string;
}

export interface BridgeSummary {
  total: number;
  critical: number;
  tamper: number;
  lastEventAt: number | null;
}

export interface CyberControlsView {
  productionId: string;
  controls: CyberControl[];
  bridge: BridgeSummary;
}

const ISOLATION_EVENT = "biometric.isolation_attested";
const CUSTODY_EVENT = "security.custody_attested";

// Integrity-relevant Bridge events (cyber risk), distinct from routine lifecycle.
const TAMPER_EVENT_TYPES = new Set([
  "tamper_detected",
  "unexpected_copy",
  "hash_mismatch",
  "re_access_denied",
]);

// Per-licence attestation coverage → a control status. met = every licence
// attested, partial = some, gap = none (with licences in scope), n/a = no licences.
function coverageStatus(attested: number, total: number): ControlStatus {
  if (total === 0) return "n/a";
  if (attested === 0) return "gap";
  if (attested < total) return "partial";
  return "met";
}

export async function buildCyberControls(
  db: Db,
  productionId: string,
  regime: RegimeId,
): Promise<CyberControlsView> {
  const { events, licenceIds } = await evaluateScope(db, "production", productionId, regime);

  // Per-licence presence of each attestation type.
  const isolationLicences = new Set<string>();
  const custodyLicences = new Set<string>();
  for (const e of events) {
    const lid = e.chainKey.startsWith("licence:") ? e.chainKey.slice("licence:".length) : null;
    if (!lid) continue;
    if (e.eventType === ISOLATION_EVENT) isolationLicences.add(lid);
    else if (e.eventType === CUSTODY_EVENT) custodyLicences.add(lid);
  }
  const total = licenceIds.length;

  // Bridge device-integrity posture for the production's packages.
  const packageIds = total
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
  if (total) {
    const grantPkgs = await db
      .select({ packageId: bridgeGrants.packageId })
      .from(bridgeGrants)
      .where(inArray(bridgeGrants.licenceId, licenceIds))
      .all();
    for (const g of grantPkgs) if (g.packageId && !packageIds.includes(g.packageId)) packageIds.push(g.packageId);
  }

  const bridgeRows = packageIds.length
    ? await db
        .select({
          eventType: bridgeEvents.eventType,
          severity: bridgeEvents.severity,
          createdAt: bridgeEvents.createdAt,
        })
        .from(bridgeEvents)
        .where(inArray(bridgeEvents.packageId, packageIds))
        .all()
    : [];

  const bridge: BridgeSummary = {
    total: bridgeRows.length,
    critical: bridgeRows.filter((e) => e.severity === "critical").length,
    tamper: bridgeRows.filter((e) => TAMPER_EVENT_TYPES.has(e.eventType)).length,
    lastEventAt: bridgeRows.reduce<number | null>((max, e) => (max === null || e.createdAt > max ? e.createdAt : max), null),
  };

  const integrityIncidents = bridge.critical + bridge.tamper;
  const controls: CyberControl[] = [
    {
      key: "biometric_isolation",
      title: "Biometric data isolated",
      clauseRef: "39.E",
      status: coverageStatus(isolationLicences.size, total),
      detail: total
        ? `${isolationLicences.size} of ${total} licence(s) carry a biometric-isolation attestation.`
        : "No licensed exposure on this production yet.",
    },
    {
      key: "security_custody",
      title: "Commercially-reasonable custody attested",
      clauseRef: "39.H",
      status: coverageStatus(custodyLicences.size, total),
      detail: total
        ? `${custodyLicences.size} of ${total} licence(s) carry a security-custody attestation.`
        : "No licensed exposure on this production yet.",
    },
    {
      key: "device_integrity",
      title: "Device integrity — no open tamper incidents",
      clauseRef: null,
      status: integrityIncidents === 0 ? "met" : "gap",
      detail:
        integrityIncidents === 0
          ? "No tamper or critical Bridge events recorded on covered devices."
          : `${integrityIncidents} integrity incident(s) recorded (${bridge.tamper} tamper, ${bridge.critical} critical).`,
    },
    {
      key: "access_logging",
      title: "Access continuously logged",
      clauseRef: null,
      // Access logging is always on (platform-mediated); surface it as a standing control.
      status: "met",
      detail: "Every download and Bridge access is recorded to the tamper-evident ledger.",
    },
  ];

  return { productionId, controls, bridge };
}
