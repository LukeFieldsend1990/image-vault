/**
 * Per-platform enablement for the likeness monitor.
 *
 * One ai_settings row per platform (`monitor_platform_<id>` = "true"/"false"),
 * toggled from /admin/monitor. Absent rows fall back to the registry's
 * `defaultEnabled`, so the sweep behaves identically before the migration has
 * seeded anything — and a newly registered platform is born in its declared
 * default state rather than silently on.
 */

import { inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { isMonitorPlatformId, MONITOR_PLATFORMS, type MonitorPlatformId } from "./platforms";

type Db = ReturnType<typeof getDb>;

export function platformSettingKey(id: MonitorPlatformId): string {
  return `monitor_platform_${id}`;
}

/** The set of platform ids the sweep should cover right now. */
export async function getEnabledPlatforms(db: Db): Promise<Set<MonitorPlatformId>> {
  const keys = MONITOR_PLATFORMS.map((p) => platformSettingKey(p.id));
  const rows = await db
    .select({ key: aiSettings.key, value: aiSettings.value })
    .from(aiSettings)
    .where(inArray(aiSettings.key, keys))
    .all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const enabled = new Set<MonitorPlatformId>();
  for (const platform of MONITOR_PLATFORMS) {
    const value = stored.get(platformSettingKey(platform.id));
    if (value === undefined ? platform.defaultEnabled : value === "true") {
      enabled.add(platform.id);
    }
  }
  return enabled;
}

/**
 * Per-talent overrides, stored as JSON on the talent's likeness_monitors row
 * (`platformOverridesJson`). A key present forces that platform on or off for
 * this talent regardless of the global toggle; an absent key inherits it.
 */
export type PlatformOverrides = Partial<Record<MonitorPlatformId, boolean>>;

export function parsePlatformOverrides(json: string | null | undefined): PlatformOverrides {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const overrides: PlatformOverrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isMonitorPlatformId(key) && typeof value === "boolean") {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

/** The coverage one talent's sweep actually gets: global toggles, then their overrides. */
export function applyPlatformOverrides(
  global: Set<MonitorPlatformId>,
  overrides: PlatformOverrides
): Set<MonitorPlatformId> {
  const effective = new Set(global);
  for (const platform of MONITOR_PLATFORMS) {
    const override = overrides[platform.id];
    if (override === true) effective.add(platform.id);
    else if (override === false) effective.delete(platform.id);
  }
  return effective;
}

export async function setPlatformEnabled(
  db: Db,
  id: MonitorPlatformId,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const value = enabled ? "true" : "false";
  await db
    .insert(aiSettings)
    .values({ key: platformSettingKey(id), value, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: aiSettings.key,
      set: { value, updatedAt: now, updatedBy },
    });
}
