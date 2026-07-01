/**
 * Platform kill switches for the OLP rail (singleton row). Default ON so the
 * feature works out of the box; an admin can hard-stop issuance/auto-accept.
 */
import { eq } from "drizzle-orm";
import { rslSettings } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;
const SINGLETON = "singleton";

export interface RslSettings {
  olpEnabled: boolean;
  autoAcceptEnabled: boolean;
}

export async function getRslSettings(db: Db): Promise<RslSettings> {
  const row = await db.select().from(rslSettings).where(eq(rslSettings.id, SINGLETON)).get();
  return {
    olpEnabled: row ? row.olpEnabled : true,
    autoAcceptEnabled: row ? row.autoAcceptEnabled : true,
  };
}

export async function setRslSettings(
  db: Db,
  updatedBy: string,
  patch: Partial<RslSettings>,
): Promise<RslSettings> {
  const now = Math.floor(Date.now() / 1000);
  const next = { ...(await getRslSettings(db)), ...patch };
  await db
    .insert(rslSettings)
    .values({ id: SINGLETON, olpEnabled: next.olpEnabled, autoAcceptEnabled: next.autoAcceptEnabled, updatedAt: now, updatedBy })
    .onConflictDoUpdate({
      target: rslSettings.id,
      set: { olpEnabled: next.olpEnabled, autoAcceptEnabled: next.autoAcceptEnabled, updatedAt: now, updatedBy },
    });
  return next;
}
