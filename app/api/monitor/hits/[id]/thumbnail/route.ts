import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { likenessHits } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { fetchThumbnail, storeThumbnail } from "@/lib/monitor/thumbnail-proxy";
import { eq } from "drizzle-orm";

// GET /api/monitor/hits/:id/thumbnail — the post preview for a flagged hit.
//
// Served from the copy the sweep captured into R2. Two reasons it cannot be an
// <img> pointed at the platform URL: Instagram and TikTok CDNs reject requests
// carrying a foreign Referer, and their URLs are signed and expire within days
// — a preview that loaded yesterday is a 403 today, which is what left the
// accounts view full of broken images.
//
// Hits recorded before the capture step existed have no stored copy, so the
// route falls back to fetching the live URL and stores what it gets, which
// backfills them one view at a time for as long as the URL still resolves.
//
// This is a thumbnail of content already flagged as misuse of the talent's own
// likeness, fetched on their behalf and never re-published: the response is
// private, per-session, and 404s for anyone else's hits.

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const hit = await db
    .select({
      talentId: likenessHits.talentId,
      thumbnailUrl: likenessHits.thumbnailUrl,
      thumbnailKey: likenessHits.thumbnailKey,
    })
    .from(likenessHits)
    .where(eq(likenessHits.id, id))
    .get();

  // Same 404 for "no such hit" and "not yours" — whether a hit exists is not
  // something to leak to another account.
  if (!hit || (hit.talentId !== session.sub && !isAdmin(session.email))) {
    return new NextResponse(null, { status: 404 });
  }

  let bucket: R2Bucket | undefined;
  try {
    bucket = (getCloudflareContext().env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
  } catch {
    bucket = undefined; // local dev without bindings — live fetch only
  }

  if (hit.thumbnailKey && bucket) {
    const object = await bucket.get(hit.thumbnailKey);
    if (object) {
      const bytes = await object.arrayBuffer();
      return imageResponse(
        bytes,
        object.httpMetadata?.contentType ?? "image/jpeg",
        bytes.byteLength
      );
    }
    // Key recorded but the object is gone — fall through to the live URL.
  }

  if (!hit.thumbnailUrl) return new NextResponse(null, { status: 404 });

  const thumb = await fetchThumbnail(hit.thumbnailUrl);
  if (!thumb) return new NextResponse(null, { status: 404 });

  // Keep what we just fetched, so this hit survives the URL expiring. Failure
  // here costs nothing — the image is already on its way to the browser.
  if (bucket && !hit.thumbnailKey) {
    try {
      const key = await storeThumbnail(bucket, id, thumb);
      await db.update(likenessHits).set({ thumbnailKey: key }).where(eq(likenessHits.id, id));
    } catch {
      /* backfill is best-effort */
    }
  }

  return imageResponse(thumb.bytes, thumb.contentType, thumb.bytes.length);
}
