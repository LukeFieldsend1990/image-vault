import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { likenessHits, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { loadEvidenceRecord, renderEvidenceRecordHtml } from "@/lib/monitor/evidence";

// GET /api/monitor/hits/:id/evidence — the printable Likeness Evidence Record.
//
// Rendered on demand and never stored: the record states what the vault holds
// at the moment it is generated, so a stale stored copy would only mislead.
// Access mirrors the thumbnail route: the talent whose likeness is at issue,
// their linked reps, and admins — with the same undifferentiated 404 for
// "no such hit" and "not yours".

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const hit = await db
    .select({ talentId: likenessHits.talentId })
    .from(likenessHits)
    .where(eq(likenessHits.id, id))
    .get();

  let authorised = !!hit && (hit.talentId === session.sub || isAdmin(session.email));
  if (!authorised && hit && session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, hit.talentId)))
      .get();
    authorised = !!link;
  }
  if (!hit || !authorised) {
    return new NextResponse(null, { status: 404 });
  }

  let bucket: R2Bucket | undefined;
  try {
    bucket = (getCloudflareContext().env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
  } catch {
    bucket = undefined; // local dev without bindings — record renders without the still
  }

  const data = await loadEvidenceRecord(db, id, { bucket });
  if (!data) return new NextResponse(null, { status: 404 });

  return new NextResponse(renderEvidenceRecordHtml(data), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Private and short-lived: the record is a live snapshot, not an archive.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
