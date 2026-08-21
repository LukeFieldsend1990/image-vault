import { getDb } from "@/lib/db";
import { notifications, talentReps, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";

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

/** Notify every platform admin (whitelist in lib/auth/adminEmails). Best-effort. */
export async function notifyAdmins(db: Db, n: Omit<NewNotification, "userId">): Promise<void> {
  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, ADMIN_EMAILS as string[]))
      .all();
    await Promise.all(admins.map((a) => createNotification(db, { ...n, userId: a.id })));
  } catch {
    // best-effort
  }
}

/**
 * Notify a talent and all of their active reps (the "agent digest" fan-out).
 *
 * `repHref` swaps the link for rep recipients: talent and rep land on
 * different routes for the same event (e.g. /vault/monitor is talent-only —
 * a rep following it gets a 403 instead of their roster view).
 */
export async function notifyTalentAndReps(
  db: Db,
  talentId: string,
  n: Omit<NewNotification, "userId"> & { repHref?: string | null }
): Promise<void> {
  const { repHref, ...base } = n;
  let repIds: string[] = [];
  try {
    const reps = await db
      .select({ repId: talentReps.repId })
      .from(talentReps)
      .where(eq(talentReps.talentId, talentId))
      .all();
    repIds = reps.map((r) => r.repId).filter((id) => id !== talentId);
  } catch {
    // fall back to just the talent
  }
  await Promise.all([
    createNotification(db, { ...base, userId: talentId }),
    ...repIds.map((userId) =>
      createNotification(db, { ...base, userId, href: repHref !== undefined ? repHref : base.href })
    ),
  ]);
}
