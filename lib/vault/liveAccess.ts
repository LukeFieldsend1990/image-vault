/**
 * Who can reach this scan *right now*.
 *
 * The chain-of-custody record is retrospective — it says what has happened. This
 * is the present tense, and it turns out to be the harder question, because live
 * access is not stored in one place.
 *
 * **A note on `accessWindows`, which looks like it should be the answer.** The
 * table exists, `resolveAccessWindow` reads it, and the bridge open route gates
 * on it — but nothing in the codebase ever inserts a row (migration 0027 ships
 * the backfill commented out). So it returns "no window" for every licence and
 * the gate is a no-op. Building on it would render an empty panel forever.
 *
 * What actually confers live access, and is therefore what this reads:
 *
 *  - **Bridge grants** — a signed, offline-verifiable capability. Live while
 *    `revokedAt IS NULL AND expiresAt > now`. Deduped by (licence, device),
 *    because reopening supersedes rather than adds; without that one vendor
 *    reopening ten times reads as ten vendors.
 *  - **`licences.preauthUntil`** — the real standing "skip talent 2FA" window
 *    (`preauthUntil > now && !permitAiTraining`). A migration comment calls this
 *    dead; it is not.
 *  - **An in-flight dual-custody session** in KV, and the download tokens it has
 *    already minted. Those tokens outlive the session by up to 48h, which is
 *    exactly the kind of thing a live panel should surface.
 *  - **The licence itself** — status, validity window, and `deliveryMode`, since
 *    a `bridge_only` licence cannot use the download path at all.
 */

import { eq, inArray } from "drizzle-orm";
import { bridgeDevices, bridgeGrants, licences, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { computePurgeGrace, formatGraceRemaining } from "@/lib/bridge/purgeGrace";

type Db = ReturnType<typeof getDb>;

interface Kv {
  get(key: string): Promise<string | null>;
}

export interface LiveGrant {
  grantId: string;
  userEmail: string | null;
  tool: string;
  deviceId: string | null;
  deviceName: string | null;
  expiresAt: number;
  /** Set once a purge has been requested but not yet confirmed complete. */
  purgeRequestedAt: number | null;
  /** Display-only estimate of the bridge's offline purge grace. */
  purgeGrace: string | null;
}

/** An in-flight dual-custody handshake, and any tokens it has already minted. */
export interface LiveHandshake {
  step: string;
  expiresAt: number;
  tokenCount: number;
}

export interface LiveLicenceAccess {
  licenceId: string;
  shortCode: string | null;
  projectName: string;
  productionCompany: string;
  licenseeEmail: string | null;
  status: string;
  validFrom: number;
  validTo: number;
  deliveryMode: string;
  /** True when the licence is in force right now — status, dates and revocation all agree. */
  inForce: boolean;
  /** Live pre-authorisation expiry, when one is active. */
  preauthUntil: number | null;
  grants: LiveGrant[];
  handshake: LiveHandshake | null;
  /** Everything that currently confers reach, counted. Zero means nobody can open it. */
  openPaths: number;
}

export interface LiveAccess {
  packageId: string;
  licences: LiveLicenceAccess[];
  summary: {
    licencesInForce: number;
    liveGrants: number;
    activePreauths: number;
    openHandshakes: number;
    outstandingTokens: number;
  };
  checkedAt: number;
}

/** Statuses under which a licence still confers reach. */
const IN_FORCE = new Set(["APPROVED", "SCRUB_PERIOD", "OVERDUE"]);

interface DualCustodySession {
  step?: string;
  expiresAt?: number;
  downloadTokens?: unknown[];
}

export async function resolveLiveAccess(db: Db, kv: Kv, packageId: string): Promise<LiveAccess> {
  const now = Math.floor(Date.now() / 1000);

  const licenceRows = await db
    .select({
      id: licences.id,
      shortCode: licences.shortCode,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      licenseeId: licences.licenseeId,
      status: licences.status,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      revokedAt: licences.revokedAt,
      deliveryMode: licences.deliveryMode,
      preauthUntil: licences.preauthUntil,
      permitAiTraining: licences.permitAiTraining,
    })
    .from(licences)
    .where(eq(licences.packageId, packageId))
    .all();

  if (licenceRows.length === 0) {
    return {
      packageId,
      licences: [],
      summary: { licencesInForce: 0, liveGrants: 0, activePreauths: 0, openHandshakes: 0, outstandingTokens: 0 },
      checkedAt: now,
    };
  }

  const licenceIds = licenceRows.map((l) => l.id);

  const [grantRows, licenseeRows] = await Promise.all([
    db
      .select({
        id: bridgeGrants.id,
        licenceId: bridgeGrants.licenceId,
        userId: bridgeGrants.userId,
        tool: bridgeGrants.tool,
        deviceId: bridgeGrants.deviceId,
        expiresAt: bridgeGrants.expiresAt,
        revokedAt: bridgeGrants.revokedAt,
        purgeRequestedAt: bridgeGrants.purgeRequestedAt,
        purgeCompletedAt: bridgeGrants.purgeCompletedAt,
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

  const liveGrants = grantRows.filter((g) => g.revokedAt == null && g.expiresAt > now);

  // Resolve grant holders and their devices, so a panel can name a machine
  // rather than print a bare device id.
  const grantUserIds = [...new Set(liveGrants.map((g) => g.userId))];
  const deviceIds = [...new Set(liveGrants.map((g) => g.deviceId).filter((d): d is string => Boolean(d)))];

  const [grantUsers, devices] = await Promise.all([
    grantUserIds.length
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, grantUserIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
    deviceIds.length
      ? db
          .select({ id: bridgeDevices.id, displayName: bridgeDevices.displayName, lastSeenAt: bridgeDevices.lastSeenAt })
          .from(bridgeDevices)
          .where(inArray(bridgeDevices.id, deviceIds))
          .all()
      : Promise.resolve([] as { id: string; displayName: string; lastSeenAt: number | null }[]),
  ]);

  const emailById = new Map([...licenseeRows, ...grantUsers].map((u) => [u.id, u.email]));
  const deviceById = new Map(devices.map((d) => [d.id, d]));

  // ── Per licence ───────────────────────────────────────────────────────────
  const out: LiveLicenceAccess[] = [];
  let outstandingTokens = 0;
  let openHandshakes = 0;

  for (const l of licenceRows) {
    const inForce = IN_FORCE.has(l.status) && l.revokedAt == null && l.validTo > now;

    // Reopening the same licence on the same device supersedes the prior grant,
    // so collapse by (licence, device) — otherwise one bridge looks like many.
    const seen = new Set<string>();
    const grants: LiveGrant[] = [];
    for (const g of liveGrants) {
      if (g.licenceId !== l.id) continue;
      const key = `${g.deviceId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const device = g.deviceId ? deviceById.get(g.deviceId) : undefined;
      const grace = computePurgeGrace({
        lastHeartbeatAt: device?.lastSeenAt ?? null,
        revoked: false,
        pendingAction: g.purgeRequestedAt && !g.purgeCompletedAt ? "purge" : null,
        now,
      });

      grants.push({
        grantId: g.id,
        userEmail: emailById.get(g.userId) ?? null,
        tool: g.tool,
        deviceId: g.deviceId,
        deviceName: device?.displayName ?? null,
        expiresAt: g.expiresAt,
        purgeRequestedAt: g.purgeRequestedAt ?? null,
        purgeGrace: grace.kind === "counting" ? formatGraceRemaining(grace.secondsRemaining) : null,
      });
    }

    // Pre-auth is only live on a licence that does not permit AI training —
    // the same condition the download route enforces.
    const preauthUntil =
      l.preauthUntil && l.preauthUntil > now && !l.permitAiTraining ? l.preauthUntil : null;

    let handshake: LiveHandshake | null = null;
    try {
      const raw = await kv.get(`dual_custody:${l.id}`);
      if (raw) {
        const session = JSON.parse(raw) as DualCustodySession;
        const tokenCount = Array.isArray(session.downloadTokens) ? session.downloadTokens.length : 0;
        handshake = {
          step: session.step ?? "unknown",
          expiresAt: session.expiresAt ?? now,
          tokenCount,
        };
        outstandingTokens += tokenCount;
        openHandshakes += 1;
      }
    } catch {
      // A malformed or unreachable session must not take the whole panel down —
      // the grants above are the more important half.
    }

    out.push({
      licenceId: l.id,
      shortCode: l.shortCode,
      projectName: l.projectName,
      productionCompany: l.productionCompany,
      licenseeEmail: emailById.get(l.licenseeId) ?? null,
      status: l.status,
      validFrom: l.validFrom,
      validTo: l.validTo,
      deliveryMode: l.deliveryMode,
      inForce,
      preauthUntil,
      grants,
      handshake,
      openPaths: grants.length + (preauthUntil ? 1 : 0) + (handshake ? 1 : 0),
    });
  }

  // Licences that can currently be reached first, then most recently valid.
  out.sort((a, b) => Number(b.inForce) - Number(a.inForce) || b.validTo - a.validTo);

  return {
    packageId,
    licences: out,
    summary: {
      licencesInForce: out.filter((l) => l.inForce).length,
      liveGrants: out.reduce((n, l) => n + l.grants.length, 0),
      activePreauths: out.filter((l) => l.preauthUntil).length,
      openHandshakes,
      outstandingTokens,
    },
    checkedAt: now,
  };
}
