import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyImageToken } from "@/lib/pitch/imageToken";

// GET /api/pitch/image?token=<signed token>
//
// Gated proxy that streams a single R2 source image to whoever holds a valid,
// unexpired token. Intentionally unauthenticated by session — external services
// (Higgsfield) fetch this — the HMAC token IS the authorisation. The token is
// minted only by the higgs-worker for images already validated as belonging to
// the pitch's package, so this can only ever serve those specific objects.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const { env } = getCloudflareContext();
  const secret = (env as unknown as { PITCH_IMAGE_TOKEN_SECRET?: string }).PITCH_IMAGE_TOKEN_SECRET;
  if (!secret) return NextResponse.json({ error: "Image proxy not configured" }, { status: 503 });

  const verified = await verifyImageToken(secret, token);
  if (!verified) return NextResponse.json({ error: "Invalid or expired token" }, { status: 403 });

  const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;
  const obj = await bucket.get(verified.r2Key);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
    },
  });
}
