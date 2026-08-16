import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessHits } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  MAX_THUMBNAIL_BYTES,
  THUMBNAIL_TIMEOUT_MS,
  isFetchableThumbnailUrl,
} from "@/lib/monitor/thumbnail-proxy";
import { eq } from "drizzle-orm";

// GET /api/monitor/hits/:id/thumbnail — the post preview for a flagged hit.
//
// Hotlinking the stored platform URL straight from an <img> does not work:
// Instagram and TikTok CDNs reject requests carrying a foreign Referer, so
// every preview in the accounts view rendered as a broken-image icon. The
// Worker fetches it instead — server-side there is no Referer to send — and
// streams the bytes back to the talent who owns the hit.
//
// This is a thumbnail of content already flagged as misuse of the talent's
// own likeness, fetched on their behalf and never re-published: the response
// is private, per-session, and 404s for anyone else's hits.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();
  const hit = await db
    .select({ talentId: likenessHits.talentId, thumbnailUrl: likenessHits.thumbnailUrl })
    .from(likenessHits)
    .where(eq(likenessHits.id, id))
    .get();

  // Same 404 for "no such hit" and "not yours" — whether a hit exists is not
  // something to leak to another account.
  if (!hit || (hit.talentId !== session.sub && !isAdmin(session.email))) {
    return new NextResponse(null, { status: 404 });
  }
  if (!hit.thumbnailUrl) return new NextResponse(null, { status: 404 });

  const url = isFetchableThumbnailUrl(hit.thumbnailUrl);
  if (!url) return new NextResponse(null, { status: 404 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THUMBNAIL_TIMEOUT_MS);
  try {
    const upstream = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    });
    if (!upstream.ok) return new NextResponse(null, { status: 404 });

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return new NextResponse(null, { status: 404 });

    // Buffer rather than stream: the size cap has to be enforced against real
    // bytes, and a thumbnail is small enough that it costs nothing.
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_THUMBNAIL_BYTES) return new NextResponse(null, { status: 404 });

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        // Platform CDN URLs are signed and expire, so cache briefly and let it
        // re-fetch rather than pinning a URL that has since gone dead.
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  } finally {
    clearTimeout(timer);
  }
}
