import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { pitchVignettes, talentReps } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// GET /api/pitch/:id/stream  — stream the vignette MP4 from R2
// Accepts: session cookie (reps/talent) OR ?token=<shareToken> (public share links)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const { env } = getCloudflareContext();
  const kv = env.SESSIONS_KV;
  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;

  // ── Auth: share token OR session ──────────────────────────────────
  const shareToken = req.nextUrl.searchParams.get("token");
  let authorised = false;

  if (shareToken) {
    const tokenData = await kv.get(`pitch_share:${shareToken}`);
    if (tokenData) {
      const parsed = JSON.parse(tokenData) as { pitchId: string };
      authorised = parsed.pitchId === id;
    }
  } else {
    const session = await requireSession(req);
    if (!isErrorResponse(session)) {
      const admin = session.role === "admin" || isAdmin(session.email);
      const vignette = await db.select({ talentId: pitchVignettes.talentId, createdBy: pitchVignettes.createdBy })
        .from(pitchVignettes).where(eq(pitchVignettes.id, id)).get();

      if (vignette) {
        if (admin || session.sub === vignette.talentId || session.sub === vignette.createdBy) {
          authorised = true;
        } else if (session.role === "rep") {
          const link = await db.select({ id: talentReps.id })
            .from(talentReps)
            .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, vignette.talentId)))
            .get();
          authorised = !!link;
        }
      }
    }
  }

  if (!authorised) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const vignette = await db.select({ outputR2Key: pitchVignettes.output_r2_key, status: pitchVignettes.status })
    .from(pitchVignettes).where(eq(pitchVignettes.id, id)).get();

  if (!vignette) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (vignette.status !== "complete" || !vignette.outputR2Key) {
    return NextResponse.json({ error: "Vignette not ready" }, { status: 404 });
  }

  const obj = await bucket.get(vignette.outputR2Key);
  if (!obj) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
    },
  });
}
