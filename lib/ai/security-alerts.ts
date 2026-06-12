import type { drizzle } from "drizzle-orm/d1";
import {
  suggestions,
  downloadEvents,
  bridgeEvents,
  licences,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { isAiEnabled } from "./cost-tracker";
import { SUGGESTION_TTL_SECONDS } from "./constants";

type Db = ReturnType<typeof drizzle>;

/**
 * Escalation descriptor handed to the ambient security agent
 * (lib/ai/security-agent.ts) when heuristics detect an action_required event.
 * All string fields are attacker-influenceable and must be treated as
 * untrusted data by anything that feeds them to an LLM.
 */
export type SecurityTrigger =
  | {
      kind: "bridge";
      eventType: string;
      severity: string;
      deviceId: string;
      packageId: string;
      packageName: string;
      talentId: string;
      recentCriticalCount: number;
    }
  | {
      kind: "download";
      licenceId: string;
      licenseeId: string;
      ip: string | null;
      downloads24h: number;
      knownIpCount: number;
      talentId: string;
      projectName: string;
    };

export interface SecurityEscalation {
  escalate: boolean;
  trigger?: SecurityTrigger;
}

async function getLicenceAlertCountToday(db: Db, licenceId: string): Promise<number> {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.category, "security"),
        eq(suggestions.entityType, "licence"),
        eq(suggestions.entityId, licenceId),
        sql`created_at > ${dayAgo}`
      )
    )
    .get();
  return row?.count ?? 0;
}

export async function writeSuggestion(
  db: Db,
  params: {
    userId: string;
    category: string;
    title: string;
    body: string;
    deepLink?: string;
    entityType: string;
    entityId: string;
    priority: number;
    feature?: string;
  }
) {
  const now = Math.floor(Date.now() / 1000);
  await db.insert(suggestions).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    category: params.category,
    feature: params.feature ?? "security_alert",
    title: params.title,
    body: params.body,
    deepLink: params.deepLink ?? null,
    entityType: params.entityType,
    entityId: params.entityId,
    priority: params.priority,
    acknowledgedAt: null,
    clickedAt: null,
    expiresAt: now + SUGGESTION_TTL_SECONDS,
    batchId: null,
    createdAt: now,
  });
}

export async function checkDownloadAnomalies(
  db: Db,
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
  event: {
    licenceId: string | null;
    licenseeId: string;
    fileId: string;
    ip: string | null;
  }
): Promise<SecurityEscalation> {
  const enabled = await isAiEnabled(db);
  if (!enabled || !event.licenceId) return { escalate: false };

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  // Find the talent who owns this licence
  const licence = await db
    .select({ talentId: licences.talentId, projectName: licences.projectName })
    .from(licences)
    .where(eq(licences.id, event.licenceId))
    .get();
  if (!licence) return { escalate: false };

  // Rate limit: max 5 alerts per licence per day
  const licenceAlerts = await getLicenceAlertCountToday(db, event.licenceId);
  if (licenceAlerts >= 5) return { escalate: false };

  // Check 1: Unusual download volume (>3 from same licence in 24h)
  const recentDownloads = await db
    .select({ count: sql<number>`count(*)` })
    .from(downloadEvents)
    .where(
      and(
        eq(downloadEvents.licenceId, event.licenceId),
        sql`started_at > ${dayAgo}`
      )
    )
    .get();
  const downloads24h = recentDownloads?.count ?? 0;
  const volumeAnomaly = downloads24h > 3;

  if (volumeAnomaly) {
    await writeSuggestion(db, {
      userId: licence.talentId,
      category: "attention",
      title: "Unusual download volume",
      body: `${downloads24h} downloads from licence "${licence.projectName}" in the last 24 hours. This is higher than typical — worth verifying the licensee's activity.`,
      deepLink: `/vault/licences`,
      entityType: "licence",
      entityId: event.licenceId,
      priority: 20,
    });
  }

  // Check 2: New IP for this licensee
  let newIpAnomaly = false;
  let knownIpCount = 0;
  if (event.ip) {
    const previousIps = await db
      .select({ ip: downloadEvents.ip })
      .from(downloadEvents)
      .where(
        and(
          eq(downloadEvents.licenseeId, event.licenseeId),
          sql`started_at < ${now}`,
          sql`ip IS NOT NULL`
        )
      )
      .groupBy(downloadEvents.ip)
      .all();

    const knownIps = new Set(previousIps.map((r) => r.ip));
    knownIpCount = knownIps.size;
    newIpAnomaly = knownIps.size > 0 && !knownIps.has(event.ip);
    if (newIpAnomaly) {
      await writeSuggestion(db, {
        userId: licence.talentId,
        category: "attention",
        title: "Download from new IP address",
        body: `A download for "${licence.projectName}" was initiated from a previously unseen IP address. The licensee has used ${knownIps.size} other IP(s) historically.`,
        deepLink: `/vault/licences`,
        entityType: "licence",
        entityId: event.licenceId,
        priority: 25,
      });
    }
  }

  // Escalate to the security agent when the signals compound:
  // both anomalies at once, or extreme volume on its own.
  if ((volumeAnomaly && newIpAnomaly) || downloads24h > 10) {
    return {
      escalate: true,
      trigger: {
        kind: "download",
        licenceId: event.licenceId,
        licenseeId: event.licenseeId,
        ip: event.ip,
        downloads24h,
        knownIpCount,
        talentId: licence.talentId,
        projectName: licence.projectName,
      },
    };
  }

  return { escalate: false };
}

export async function checkBridgeAnomalies(
  db: Db,
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
  event: {
    grantId: string | null;
    packageId: string;
    deviceId: string;
    eventType: string;
    severity: string;
    userId: string | null;
  }
): Promise<SecurityEscalation> {
  const enabled = await isAiEnabled(db);
  if (!enabled) return { escalate: false };

  const criticalEvents = new Set(["tamper_detected", "hash_mismatch", "unexpected_copy"]);
  if (!criticalEvents.has(event.eventType)) return { escalate: false };

  const dayAgo = Math.floor(Date.now() / 1000) - 86400;

  // Find the talent who owns this package
  const pkg = await db
    .select({ talentId: sql<string>`talent_id`, name: sql<string>`name` })
    .from(sql`scan_packages`)
    .where(sql`id = ${event.packageId}`)
    .get();
  if (!pkg) return { escalate: false };

  // Count recent critical events from same device
  const recentEvents = await db
    .select({ count: sql<number>`count(*)` })
    .from(bridgeEvents)
    .where(
      and(
        eq(bridgeEvents.deviceId, event.deviceId),
        sql`created_at > ${dayAgo}`,
        sql`event_type IN ('tamper_detected', 'hash_mismatch', 'unexpected_copy')`
      )
    )
    .get();
  const recentCriticalCount = recentEvents?.count ?? 0;

  const isActionRequired = recentCriticalCount >= 2 || event.eventType === "tamper_detected";

  if (isActionRequired) {
    // Hand off to the ambient security agent (lib/ai/security-agent.ts).
    // Its decline path writes the same template alert this module used to.
    return {
      escalate: true,
      trigger: {
        kind: "bridge",
        eventType: event.eventType,
        severity: event.severity,
        deviceId: event.deviceId,
        packageId: event.packageId,
        packageName: pkg.name,
        talentId: pkg.talentId,
        recentCriticalCount,
      },
    };
  }

  await writeSuggestion(db, {
    userId: pkg.talentId,
    category: "attention",
    title: `Bridge: ${event.eventType.replace(/_/g, " ")}`,
    body: `${event.eventType.replace(/_/g, " ")} detected on device ${event.deviceId.slice(0, 8)}... for package "${pkg.name}". ${recentCriticalCount} critical events from this device in the last 24 hours.`,
    deepLink: `/settings/bridge`,
    entityType: "package",
    entityId: event.packageId,
    priority: 15,
  });

  return { escalate: false };
}
