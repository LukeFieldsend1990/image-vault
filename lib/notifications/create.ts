import { getDb } from "@/lib/db";
import { notifications, talentReps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
}

/**
 * Insert an in-app notification. Safe to call fire-and-forget — failures are
 * swallowed so a notification never breaks the action that triggered it.
 */
export async function createNotification(db: Db, n: NewNotification): Promise<void> {
  try {
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      read: false,
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch {
    // best-effort
  }
}

/** Notify a talent and all of their active reps (the "agent digest" fan-out). */
export async function notifyTalentAndReps(
  db: Db,
  talentId: string,
  n: Omit<NewNotification, "userId">
): Promise<void> {
  const recipients = new Set<string>([talentId]);
  try {
    const reps = await db
      .select({ repId: talentReps.repId })
      .from(talentReps)
      .where(eq(talentReps.talentId, talentId))
      .all();
    reps.forEach((r) => recipients.add(r.repId));
  } catch {
    // fall back to just the talent
  }
  await Promise.all(Array.from(recipients).map((userId) => createNotification(db, { ...n, userId })));
}
