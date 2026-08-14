import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { MONITOR_PLATFORMS, isMonitorPlatformId } from "@/lib/monitor/platforms";
import { getEnabledPlatforms, setPlatformEnabled } from "@/lib/monitor/platform-settings";
import { apifyToken } from "@/lib/monitor/ingest/apify";
import { youtubeApiKey } from "@/lib/monitor/ingest/youtube";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// GET /api/admin/monitor/platforms — every registry platform with its toggle
// state and whether the credential its discovery route needs is present.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const enabled = await getEnabledPlatforms(db);
  const { env } = getCloudflareContext();
  const cfEnv = env as unknown as { APIFY_TOKEN?: string; YOUTUBE_API_KEY?: string };
  const hasApify = apifyToken(cfEnv) !== null;
  const hasYouTube = youtubeApiKey(cfEnv) !== null;

  return NextResponse.json({
    platforms: MONITOR_PLATFORMS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      source: p.source,
      enabled: enabled.has(p.id),
      defaultEnabled: p.defaultEnabled,
      // "configured" = the credential this platform's live route needs exists.
      // An enabled-but-unconfigured platform falls back to the simulated
      // crawler (or is simply skipped in live mode), so the UI should say so.
      configured: p.source === "apify" ? hasApify : p.source === "youtube_api" ? hasYouTube : true,
    })),
  });
}

// PATCH /api/admin/monitor/platforms — flip one platform on or off.
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    platformId?: string;
    enabled?: boolean;
  };
  if (typeof body.platformId !== "string" || !isMonitorPlatformId(body.platformId)) {
    return NextResponse.json({ error: "Unknown platformId" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const db = getDb();
  await setPlatformEnabled(db, body.platformId, body.enabled, g.session.sub);
  return NextResponse.json({ ok: true });
}
