export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { indexPackageBatch } from "@/lib/search/index";
import { and, isNull, eq, sql } from "drizzle-orm";

const BATCH_SIZE = 50;

/**
 * GET /api/admin/search/reindex?confirm=true
 *
 * Backfill all existing ready, non-deleted packages into Vectorize.
 * Admin-only. Pass confirm=true to actually run.
 */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const confirm = req.nextUrl.searchParams.get("confirm") === "true";
  const db = getDb();

  // Count packages to index
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(scanPackages)
    .where(
      and(
        isNull(scanPackages.deletedAt),
        eq(scanPackages.status, "ready"),
      )
    )
    .get();

  const total = countResult?.count ?? 0;

  if (!confirm) {
    return NextResponse.json({
      message: `Would reindex ${total} packages. Pass ?confirm=true to proceed.`,
      total,
    });
  }

  const { env } = getRequestContext();

  if (!env.VECTORIZE || !env.AI) {
    return NextResponse.json(
      { error: "Vectorize or AI binding not configured" },
      { status: 503 }
    );
  }

  // Fetch all ready, non-deleted package IDs
  const allPackages = await db
    .select({ id: scanPackages.id })
    .from(scanPackages)
    .where(
      and(
        isNull(scanPackages.deletedAt),
        eq(scanPackages.status, "ready"),
      )
    )
    .all();

  // Process in batches
  let indexed = 0;
  for (let i = 0; i < allPackages.length; i += BATCH_SIZE) {
    const batch = allPackages.slice(i, i + BATCH_SIZE).map((p) => p.id);
    indexed += await indexPackageBatch(env, db, batch);
  }

  return NextResponse.json({
    message: `Reindexed ${indexed} of ${total} packages`,
    indexed,
    total,
  });
}
