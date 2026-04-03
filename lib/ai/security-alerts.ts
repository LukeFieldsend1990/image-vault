import { getDb } from "@/lib/db";
import {
  suggestions,
  downloadEvents,
  bridgeEvents,
  licences,
  users,
  aiCostLog,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { callAi } from "./providers";
import { isAiEnabled, getSettingValue } from "./cost-tracker";
import { SECURITY_ALERT_PROMPT, SUGGESTION_TTL_SECONDS } from "./constants";

type Db = ReturnType<typeof getDb>;

async function getDailyAlertCount(db: Db): Promise<number> {
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiCostLog)
    .where(
      and(
        eq(aiCostLog.feature, "security_alerts"),
        sql`created_at > ${dayAgo}`
      )
    )
    .get();
  return row?.count ?? 0;
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

async function writeSuggestion(
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
  }
) {
  const now = Math.floor(Date.now() / 1000);
  await db.insert(suggestions).values({
    id: crypto.randomUUID(),
    userId: params.userId,
    category: params.category,
    feature: "security_alert",
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
) {
  const enabled = await isAiEnabled(db);
  if (!enabled || !event.licenceId) return;

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  // Find the talent who owns this licence
  const licence = await db
    .select({ talentId: licences.talentId, projectName: licences.projectName })
    .from(licences)
    .where(eq(licences.id, event.licenceId))
    .get();
  if (!licence) return;

  // Rate limit: max 5 alerts per licence per day
  const licenceAlerts = await getLicenceAlertCountToday(db, event.licenceId);
  if (licenceAlerts >= 5) return;

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

  if ((recentDownloads?.count ?? 0) > 3) {
    await writeSuggestion(db, {
      userId: licence.talentId,
      category: "attention",
      title: "Unusual download volume",
      body: `${recentDownloads!.count} downloads from licence "${licence.projectName}" in the last 24 hours. This is higher than typical — worth verifying the licensee's activity.`,
      deepLink: `/vault/licences`,
      entityType: "licence",
      entityId: event.licenceId,
      priority: 20,
    });
  }

  // Check 2: New IP for this licensee
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
    if (knownIps.size > 0 && !knownIps.has(event.ip)) {
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
) {
  const enabled = await isAiEnabled(db);
  if (!enabled) return;

  const criticalEvents = new Set(["tamper_detected", "hash_mismatch", "unexpected_copy"]);
  if (!criticalEvents.has(event.eventType)) return;

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  // Find the talent who owns this package
  const pkg = await db
    .select({ talentId: sql<string>`talent_id`, name: sql<string>`name` })
    .from(sql`scan_packages`)
    .where(sql`id = ${event.packageId}`)
    .get();
  if (!pkg) return;

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

  const isActionRequired = (recentEvents?.count ?? 0) >= 2 || event.eventType === "tamper_detected";
  const category = isActionRequired ? "action_required" : "attention";

  // For action_required, use LLM to compose a richer alert (if within daily limit)
  const maxAlerts = parseInt(await getSettingValue(db, "max_security_alerts_per_day") ?? "10");
  const dailyCount = await getDailyAlertCount(db);

  let alertBody: string;

  if (isActionRequired && dailyCount < maxAlerts) {
    const result = await callAi(env, db, {
      feature: "security_alerts",
      requiresReasoning: false,
      system: SECURITY_ALERT_PROMPT,
      userMessage: JSON.stringify({
        eventType: event.eventType,
        deviceId: event.deviceId,
        packageName: pkg.name,
        recentCriticalEventsFromDevice: recentEvents?.count ?? 0,
        severity: event.severity,
      }),
    });

    if (result) {
      try {
        const parsed = JSON.parse(result.text);
        alertBody = parsed.alert ?? result.text;
      } catch {
        alertBody = result.text;
      }
    } else {
      alertBody = `${event.eventType.replace(/_/g, " ")} detected on device ${event.deviceId.slice(0, 8)}... for package "${pkg.name}". ${(recentEvents?.count ?? 0)} critical events from this device in the last 24 hours.`;
    }
  } else {
    // Template string fallback
    alertBody = `${event.eventType.replace(/_/g, " ")} detected on device ${event.deviceId.slice(0, 8)}... for package "${pkg.name}". ${(recentEvents?.count ?? 0)} critical events from this device in the last 24 hours.`;
  }

  await writeSuggestion(db, {
    userId: pkg.talentId,
    category,
    title: `Bridge: ${event.eventType.replace(/_/g, " ")}`,
    body: alertBody,
    deepLink: `/settings/bridge`,
    entityType: "package",
    entityId: event.packageId,
    priority: isActionRequired ? 5 : 15,
  });
}
