import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { scanPackages } from "@/lib/db/schema";
import { resolveLiveAccess, type LiveAccess } from "@/lib/vault/liveAccess";
import { eq } from "drizzle-orm";

/**
 * GET /api/vault/packages/[packageId]/access
 *
 * Who can reach this scan right now. Kept separate from the activity route so
 * the custody document's payload stays lean — that one is a print artefact and
 * should not carry live state that changes between load and print.
 *
 * Same authorisation as the custody record: the performer, their rep, or an
 * admin. Never cached — a stale answer to "who has access now" is worse than no
 * answer.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  const isOwner = pkg.talentId === session.sub;
  const admin = isAdmin(session.email);
  const isRep = !isOwner && !admin && session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));

  if (!isOwner && !isRep && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const access: LiveAccess = await resolveLiveAccess(db, getKv(), packageId);

  return NextResponse.json(access, { headers: { "Cache-Control": "no-store" } });
}
