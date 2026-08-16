import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { monitorAccountLinks, monitorAccounts } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { and, desc, eq } from "drizzle-orm";

// Cross-platform sibling leads (lib/monitor/cross-platform.ts).
//
// GET  — every lead a sweep has recorded, newest first, with its source account.
// POST — { id, action: "promote" | "dismiss" }. Promotion puts a name-only lead
//        on the watchlist; dismissal closes it so no future sweep re-probes it.

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  const links = await db
    .select({
      id: monitorAccountLinks.id,
      platform: monitorAccountLinks.platform,
      handle: monitorAccountLinks.handle,
      status: monitorAccountLinks.status,
      matchedPosts: monitorAccountLinks.matchedPosts,
      bestSimilarity: monitorAccountLinks.bestSimilarity,
      evidenceJson: monitorAccountLinks.evidenceJson,
      promotedAccountId: monitorAccountLinks.promotedAccountId,
      createdAt: monitorAccountLinks.createdAt,
      sourceAccountId: monitorAccountLinks.sourceAccountId,
      sourceHandle: monitorAccounts.handle,
      sourcePlatform: monitorAccounts.platform,
      sourceReach: monitorAccounts.cumulativeViews,
    })
    .from(monitorAccountLinks)
    .leftJoin(monitorAccounts, eq(monitorAccounts.id, monitorAccountLinks.sourceAccountId))
    .orderBy(desc(monitorAccountLinks.createdAt))
    .limit(200)
    .all();

  return NextResponse.json({
    links: links.map((l) => ({
      ...l,
      examples: JSON.parse(l.evidenceJson ?? "[]") as string[],
      evidenceJson: undefined,
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const db = getDb();

  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || (body.action !== "promote" && body.action !== "dismiss")) {
    return NextResponse.json({ error: "id and action (promote | dismiss) are required" }, { status: 400 });
  }

  const link = await db
    .select()
    .from(monitorAccountLinks)
    .where(eq(monitorAccountLinks.id, body.id))
    .get();
  if (!link) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (body.action === "dismiss") {
    await db
      .update(monitorAccountLinks)
      .set({ status: "dismissed" })
      .where(eq(monitorAccountLinks.id, link.id));
    return NextResponse.json({ ok: true, status: "dismissed" });
  }

  // Promotion is idempotent: an account already on the watchlist is reused
  // rather than duplicated (platform+handle is unique).
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .select({ id: monitorAccounts.id })
    .from(monitorAccounts)
    .where(and(eq(monitorAccounts.platform, link.platform), eq(monitorAccounts.handle, link.handle)))
    .get();

  let accountId = existing?.id;
  if (!accountId) {
    accountId = crypto.randomUUID();
    await db.insert(monitorAccounts).values({
      id: accountId,
      platform: link.platform,
      handle: link.handle,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "watchlist",
      notes: "Cross-platform lead promoted by an admin.",
    });
  }

  await db
    .update(monitorAccountLinks)
    .set({ status: "confirmed", promotedAccountId: accountId })
    .where(eq(monitorAccountLinks.id, link.id));

  return NextResponse.json({ ok: true, status: "confirmed", accountId });
}
