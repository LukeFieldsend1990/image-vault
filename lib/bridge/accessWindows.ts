import type { getDb } from "@/lib/db";
import { accessWindows, accessWindowEvents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

export type WindowState =
  | { kind: "none" }
  | { kind: "active"; window: AccessWindowRow; remaining: number }
  | { kind: "exhausted"; window: AccessWindowRow }
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

// Returns the current state of the access window for a licence.
// Does NOT mutate status on expiry — expiry transitions happen elsewhere (cron/
// on next interaction). Callers should treat `expired` + `exhausted` as blocking.
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
  if (row.downloadsUsed >= row.maxDownloads) return { kind: "exhausted", window: row };
  return { kind: "active", window: row, remaining: row.maxDownloads - row.downloadsUsed };
}

// Record a download against an active access window.
// Increments downloads_used, logs a `download` event, and — if this consumes
// the last permitted download — transitions the window to `exhausted` and
// logs an `exhausted` event in the same call.
export async function recordAccessWindowDownload(
  db: Db,
  params: {
    window: AccessWindowRow;
    actorId: string;
    metadata?: Record<string, unknown>;
    now: number;
  },
): Promise<{ newDownloadsUsed: number; nowExhausted: boolean }> {
  const { window, actorId, metadata, now } = params;
  const newUsed = window.downloadsUsed + 1;
  const nowExhausted = newUsed >= window.maxDownloads;

  await db
    .update(accessWindows)
    .set({
      downloadsUsed: newUsed,
      status: nowExhausted ? "exhausted" : "active",
    })
    .where(eq(accessWindows.id, window.id));

  await db.insert(accessWindowEvents).values({
    id: crypto.randomUUID(),
    windowId: window.id,
    eventType: "download",
    actorId,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: now,
  });

  if (nowExhausted) {
    await db.insert(accessWindowEvents).values({
      id: crypto.randomUUID(),
      windowId: window.id,
      eventType: "exhausted",
      actorId,
      metadata: null,
      createdAt: now,
    });
  }

  return { newDownloadsUsed: newUsed, nowExhausted };
}
