// POST /api/pitch/webhook — Higgsfield job completion webhook.
// Higgsfield is told about this URL via the `?hf_webhook=<url>` query param on
// submit and is configured with a shared secret. The exact signature header /
// HMAC encoding isn't in the public docs, so we verify an HMAC-SHA256 of the
// raw body against the common header names when HIGGSFIELD_WEBHOOK_SECRET is set.
// This is a secondary completion path — the worker also polls to completion.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pitchVignettes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface HiggsWebhookPayload {
  request_id?: string;
  jobId?: string;
  job_id?: string;
  status?: string;
  video?: { url?: string };
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
  if (s === "failed" || s === "error" || s === "nsfw") return "failed";
  return "generating";
}

export async function POST(req: NextRequest) {
  const bodyText = await req.text();

  const { env } = getCloudflareContext();
  const webhookSecret = (env as unknown as { HIGGSFIELD_WEBHOOK_SECRET?: string }).HIGGSFIELD_WEBHOOK_SECRET;

  if (webhookSecret) {
    const valid = await verifySignature(req, webhookSecret, bodyText);
    if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: HiggsWebhookPayload;
  try { payload = JSON.parse(bodyText); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobId = payload.request_id ?? payload.jobId ?? payload.job_id;
  if (!jobId) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });

  const db = getDb();
  const pitch = await db.select({ id: pitchVignettes.id, status: pitchVignettes.status })
    .from(pitchVignettes)
    .where(eq(pitchVignettes.higgsfield_job_id, jobId))
    .get();

  if (!pitch) return NextResponse.json({ ok: true });  // unknown job, ignore
  if (pitch.status === "complete" || pitch.status === "failed") return NextResponse.json({ ok: true });

  const status = normaliseStatus(payload.status ?? "");
  const videoUrl = payload.video?.url ?? payload.video_url ?? payload.videoUrl ?? payload.output?.url;

  if (status === "complete" && videoUrl) {
    // Fetch video and store in R2
    const bucket = (env as unknown as { SCANS_BUCKET: R2Bucket }).SCANS_BUCKET;
    const videoRes = await fetch(videoUrl);
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
