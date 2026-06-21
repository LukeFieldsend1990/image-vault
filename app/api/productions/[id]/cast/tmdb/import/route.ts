import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { importTmdbPlaceholders } from "@/lib/productions/tmdb-cast";
import { eq, and } from "drizzle-orm";

// POST /api/productions/[id]/cast/tmdb/import
// Bulk-import a production's TMDB billed cast as placeholder rows in one call.
// Idempotent / merge-not-clobber: members already present (by tmdbId) are skipped,
// so re-running on a production that gained cast adds new rows without touching
// resolved ones. Optional body `{ tmdbIds?: number[] }` imports only that subset
// (lets the wizard trim the roster before importing); omit to import everyone.
// Auth: admin, or industry org owner/admin.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({
      id: productions.id,
      type: productions.type,
      tmdbId: productions.tmdbId,
      organisationId: productions.organisationId,
    })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) {
    return NextResponse.json({ error: "Production not found" }, { status: 404 });
  }

  // Auth: admin, or industry org owner/admin (mirrors POST /cast).
  if (!isAdmin(session.email)) {
    if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership || (membership.memberRole !== "owner" && membership.memberRole !== "admin")) {
        return NextResponse.json({ error: "Forbidden — org owner or admin required" }, { status: 403 });
      }
    }
  }

  // Optional subset selection + TMDB override.
  let body: { tmdbIds?: unknown; overrideTmdbId?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const overrideTmdbId = typeof body.overrideTmdbId === "number" ? Math.floor(body.overrideTmdbId) : undefined;
  const subset = Array.isArray(body.tmdbIds)
    ? new Set(body.tmdbIds.filter((n): n is number => typeof n === "number").map((n) => Math.floor(n)))
    : null;

  const result = await importTmdbPlaceholders(db, {
    productionId: id,
    production,
    addedBy: session.sub,
    subset,
    overrideTmdbId,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { status: 201 });
}
