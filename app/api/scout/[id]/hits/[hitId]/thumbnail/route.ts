import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { trialHits, trialScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { fetchThumbnail, storeThumbnail } from "@/lib/monitor/thumbnail-proxy";
import { and, eq } from "drizzle-orm";

// GET /api/scout/:id/hits/:hitId/thumbnail — the post preview for a trial
// hit. Same serving strategy as the monitor thumbnail route: prefer the copy
// captured into R2 at sweep time, backfill from the live URL while it still
// resolves. Private, per-session, 404 for anyone else's trials.

const CACHE_CONTROL = "private, max-age=86400";

function imageResponse(body: ArrayBuffer | Uint8Array, contentType: string, length: number) {
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(length),
      "Cache-Control": CACHE_CONTROL,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; hitId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id, hitId } = await params;
  const db = getDb();
  const row = await db
    .select({
      requestedBy: trialScans.requestedBy,
      thumbnailUrl: trialHits.thumbnailUrl,
      thumbnailKey: trialHits.thumbnailKey,
    })
    .from(trialHits)
    .innerJoin(trialScans, eq(trialScans.id, trialHits.trialId))
    .where(and(eq(trialHits.id, hitId), eq(trialHits.trialId, id)))
    .get();

  const authorised = !!row && (row.requestedBy === session.sub || isAdmin(session.email));
  if (!row || !authorised) return new NextResponse(null, { status: 404 });

  let bucket: R2Bucket | undefined;
  try {
    bucket = (getCloudflareContext().env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
  } catch {
    bucket = undefined; // local dev without bindings — live fetch only
  }

  if (row.thumbnailKey && bucket) {
    const object = await bucket.get(row.thumbnailKey);
    if (object) {
      const bytes = await object.arrayBuffer();
      return imageResponse(bytes, object.httpMetadata?.contentType ?? "image/jpeg", bytes.byteLength);
    }
  }

  if (!row.thumbnailUrl) return new NextResponse(null, { status: 404 });

  const thumb = await fetchThumbnail(row.thumbnailUrl);
  if (!thumb) return new NextResponse(null, { status: 404 });

  if (bucket && !row.thumbnailKey) {
    try {
      const key = await storeThumbnail(bucket, hitId, thumb);
      await db.update(trialHits).set({ thumbnailKey: key }).where(eq(trialHits.id, hitId));
    } catch {
      /* backfill is best-effort */
    }
  }

  return imageResponse(thumb.bytes, thumb.contentType, thumb.bytes.length);
}
