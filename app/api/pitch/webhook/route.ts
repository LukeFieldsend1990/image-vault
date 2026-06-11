export const runtime = "edge";

// POST /api/pitch/webhook — Higgsfield job completion webhook
// Higgsfield signs requests with X-Higgsfield-Signature (HMAC-SHA256).
// TODO: Confirm exact signature header name and HMAC format from Higgsfield docs.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pitchVignettes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

interface HiggsWebhookPayload {
  jobId?: string;
  job_id?: string;
  status?: string;
  video_url?: string;
  videoUrl?: string;
  output?: { url?: string };
  error?: string;
}

async function verifySignature(req: NextRequest, secret: string, body: string): Promise<boolean> {
  const sig = req.headers.get("x-higgsfield-signature") ?? req.headers.get("x-signature");
  if (!sig) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = hexToBytes(sig.replace(/^sha256=/, ""));
  return crypto.subtle.verify("HMAC", key, sigBytes.buffer as ArrayBuffer, encoder.encode(body));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function normaliseStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s === "complete" || s === "completed" || s === "succeeded" || s === "success") return "complete";
  if (s === "failed" || s === "error") return "failed";
  return "generating";
}

/**
 * Only fetch completion videos from trusted Higgsfield hosts over HTTPS.
 * Guards against SSRF where a (spoofed or compromised) payload points the
 * server at an internal or attacker-controlled URL. Additional hosts can be
 * allow-listed via HIGGSFIELD_OUTPUT_HOSTS (comma-separated).
 */
function isAllowedVideoUrl(raw: string, extraHosts: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const allowed = [
    "higgsfield.ai",
    ...extraHosts.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  ];
  const host = url.hostname.toLowerCase();
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

export async function POST(req: NextRequest) {
  const bodyText = await req.text();

  const { env } = getRequestContext();
  const webhookSecret = (env as unknown as { HIGGSFIELD_WEBHOOK_SECRET?: string }).HIGGSFIELD_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // Fail closed: without the signing secret we cannot authenticate the caller.
    console.error("[pitch-webhook] HIGGSFIELD_WEBHOOK_SECRET not configured — rejecting request");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const valid = await verifySignature(req, webhookSecret, bodyText);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: HiggsWebhookPayload;
  try { payload = JSON.parse(bodyText); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = payload.jobId ?? payload.job_id;
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const db = getDb();
  const pitch = await db.select({ id: pitchVignettes.id, status: pitchVignettes.status })
    .from(pitchVignettes)
    .where(eq(pitchVignettes.higgsfield_job_id, jobId))
    .get();

  if (!pitch) return NextResponse.json({ ok: true });  // unknown job, ignore
  if (pitch.status === "complete" || pitch.status === "failed") return NextResponse.json({ ok: true });

  const status = normaliseStatus(payload.status ?? "");
  const videoUrl = payload.video_url ?? payload.videoUrl ?? payload.output?.url;

  if (status === "complete" && videoUrl) {
    const extraHosts = (env as unknown as { HIGGSFIELD_OUTPUT_HOSTS?: string }).HIGGSFIELD_OUTPUT_HOSTS ?? "";
    if (!isAllowedVideoUrl(videoUrl, extraHosts)) {
      console.error(`[pitch-webhook] Rejected video URL for pitch ${pitch.id}`);
      await db.update(pitchVignettes).set({
        status: "failed",
        error_text: "Rejected video URL host",
      }).where(eq(pitchVignettes.id, pitch.id));
      return NextResponse.json({ ok: true });
    }
    // Fetch video and store in R2
    const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;
    const videoRes = await fetch(videoUrl, { redirect: "error" });
    if (videoRes.ok) {
      const outputKey = `pitch/${pitch.id}/vignette.mp4`;
      await bucket.put(outputKey, videoRes.body!, {
        httpMetadata: { contentType: "video/mp4" },
      });
      await db.update(pitchVignettes).set({
        status: "complete",
        output_r2_key: outputKey,
        completedAt: Math.floor(Date.now() / 1000),
      }).where(eq(pitchVignettes.id, pitch.id));
    } else {
      await db.update(pitchVignettes).set({
        status: "failed",
        error_text: `Video fetch failed: ${videoRes.status}`,
      }).where(eq(pitchVignettes.id, pitch.id));
    }
  } else if (status === "failed") {
    await db.update(pitchVignettes).set({
      status: "failed",
      error_text: payload.error ?? "Higgsfield generation failed",
    }).where(eq(pitchVignettes.id, pitch.id));
  }

  return NextResponse.json({ ok: true });
}
