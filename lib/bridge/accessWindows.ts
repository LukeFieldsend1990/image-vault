import type { getDb } from "@/lib/db";
import { accessWindows, accessWindowEvents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

// Soft-count model: a window tracks and caps via signal, not by blocking.
// Hitting `maxDownloads` logs a one-time `exhausted` event for audit and
// surfaces `exceeded: true` to the bridge, but the download is still allowed.
// Time-based `expired` remains the only hard gate.
export type WindowState =
  | { kind: "none" }
  | {
      kind: "active";
      window: AccessWindowRow;
      remaining: number; // may be negative once the count runs past maxDownloads
      exceeded: boolean;
    }
  | { kind: "expired"; window: AccessWindowRow };

export type AccessWindowRow = {
  id: string;
  licenceId: string;
  talentId: string;
  licenseeId: string;
  maxDownloads: number;
  downloadsUsed: number;
  expiresAt: number;
  status: "active" | "closed" | "expired" | "exhausted";
};

export async function resolveAccessWindow(
  db: Db,
  licenceId: string,
  now: number,
): Promise<WindowState> {
  const row = await db
    .select({
      id: accessWindows.id,
      licenceId: accessWindows.licenceId,
      talentId: accessWindows.talentId,
      licenseeId: accessWindows.licenseeId,
      maxDownloads: accessWindows.maxDownloads,
      downloadsUsed: accessWindows.downloadsUsed,
      expiresAt: accessWindows.expiresAt,
      status: accessWindows.status,
    })
    .from(accessWindows)
    .where(and(eq(accessWindows.licenceId, licenceId), eq(accessWindows.status, "active")))
    .get();

  if (!row) return { kind: "none" };

  if (row.expiresAt < now) return { kind: "expired", window: row };

  const remaining = row.maxDownloads - row.downloadsUsed;
  return {
    kind: "active",
    window: row,
    remaining,
    exceeded: remaining <= 0,
  };
}

// Record a download against an active access window.
// Always increments `downloads_used` and logs a `download` event. Does NOT
// block or flip status when the count crosses `maxDownloads` — the count is
// an audit signal, not a DRM cap. The first crossing still emits a one-time
// `exhausted` event so operators can be alerted.
export async function recordAccessWindowDownload(
  db: Db,
  params: {
    window: AccessWindowRow;
    actorId: string;
    metadata?: Record<string, unknown>;
    now: number;
  },
): Promise<{ newDownloadsUsed: number; crossedThreshold: boolean; exceeded: boolean }> {
  const { window, actorId, metadata, now } = params;
  const newUsed = window.downloadsUsed + 1;
  const crossedThreshold =
    window.downloadsUsed < window.maxDownloads && newUsed >= window.maxDownloads;
  const exceeded = newUsed > window.maxDownloads;

  await db
    .update(accessWindows)
    .set({ downloadsUsed: newUsed })
    .where(eq(accessWindows.id, window.id));

  await db.insert(accessWindowEvents).values({
    id: crypto.randomUUID(),
    windowId: window.id,
    eventType: "download",
    actorId,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: now,
  });

  if (crossedThreshold) {
    await db.insert(accessWindowEvents).values({
      id: crypto.randomUUID(),
      windowId: window.id,
      eventType: "exhausted",
      actorId,
      metadata: JSON.stringify({ softCrossing: true, maxDownloads: window.maxDownloads }),
      createdAt: now,
    });
  }

  return { newDownloadsUsed: newUsed, crossedThreshold, exceeded };
}
