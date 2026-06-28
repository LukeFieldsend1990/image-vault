/**
 * Higgs Worker — AI pitch vignette generation via Higgsfield
 *
 * Queue consumer for `pitch-jobs`. Each message = { pitchId }.
 *
 * Lifecycle:
 *   1. prompt_crafting — Claude Haiku writes a cinematic video direction prompt
 *   2. submitting      — POST to Higgsfield image-to-video API
 *   3. generating      — polling Higgsfield until complete or failed
 *   4. complete        — video downloaded + stored in R2 at pitch/{id}/vignette.mp4
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { pitchVignettes, talentProfiles, users } from "./schema";
import { submitVignetteJob, pollVignetteJob, HiggsfieldError } from "./higgs-client";
import { signImageToken } from "../../lib/pitch/imageToken";

interface Env {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  ANTHROPIC_API_KEY?: string;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_MODEL?: string;
  APP_URL: string;
  // Shared HMAC secret for minting gated image-proxy tokens that Higgsfield
  // uses to fetch source frames via the main app (GET /api/pitch/image).
  PITCH_IMAGE_TOKEN_SECRET?: string;
}

// Image-proxy tokens live long enough to cover queue delay + the generation
// poll window, with margin.
const SOURCE_URL_TTL_SECS = 2 * 60 * 60;  // 2 hours

interface PitchMessage {
  pitchId: string;
}

function getDb(env: Env) {
  return drizzle(env.DB, { schema: { pitchVignettes, talentProfiles, users } });
}

// ── Anthropic prompt crafting ─────────────────────────────────────────────────

async function craftCinematicPrompt(
  apiKey: string,
  params: {
    talentName: string;
    knownFor: { title: string; year?: number; type?: string }[];
    characterDescription: string;
    tone: string;
  }
): Promise<string> {
  const knownForText = params.knownFor.length > 0
    ? params.knownFor.slice(0, 3).map((k) => k.title).join(", ")
    : "professional actor";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: `You are an AI film director writing Higgsfield video generation prompts for casting pitches. Given a talent profile and character brief, write a 2-3 sentence prompt describing a cinematic video clip. Requirements:
- Include camera movement (slow push-in, arc, drift, dolly)
- Specify lighting quality (overcast diffused, dramatic side-key, golden-hour rim, practical interior)
- Describe atmosphere and period/genre texture
- Convey the character's inner emotional state through micro-expression and body language
- Match the tone/genre specified
- The talent should feel like they inhabit the role, not pose for a photo
Output ONLY the prompt text. No preamble, no quotes, no explanation.`,
      messages: [{
        role: "user",
        content: `Talent: ${params.talentName} (known for: ${knownForText})
Character: ${params.characterDescription}
Tone: ${params.tone}`,
      }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}


// ── Status update helper ──────────────────────────────────────────────────────

async function updateStatus(
  db: ReturnType<typeof getDb>,
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  await db.update(pitchVignettes)
    .set({ status, ...extra } as Partial<typeof pitchVignettes.$inferInsert>)
    .where(eq(pitchVignettes.id, id));
}

// ── Main job handler ──────────────────────────────────────────────────────────

async function processPitchJob(pitchId: string, env: Env): Promise<void> {
  const db = getDb(env);

  const pitch = await db.select().from(pitchVignettes)
    .where(eq(pitchVignettes.id, pitchId)).get();

  if (!pitch) throw new Error(`Pitch ${pitchId} not found`);
  if (pitch.status === "complete" || pitch.status === "failed") return;

  // Graceful degradation: no API key provisioned yet. Mark the pitch failed
  // with a clear, user-facing message rather than throwing (which would retry
  // and eventually dead-letter, leaving the UI stuck on "Queued…" forever).
  const apiKey = env.HIGGSFIELD_API_KEY;
  if (!apiKey) {
    await updateStatus(db, pitchId, "failed", {
      error_text: "Pitch vignette generation isn't available yet — the Higgsfield integration hasn't been configured.",
    });
    return;
  }

  // ── 1. Craft prompt ──────────────────────────────────────────────

  await updateStatus(db, pitchId, "prompt_crafting");

  let generatedPrompt = pitch.generatedPrompt ?? "";
  if (!generatedPrompt && env.ANTHROPIC_API_KEY) {
    const profile = await db.select({
      fullName: talentProfiles.fullName,
      knownFor: talentProfiles.knownFor,
    }).from(talentProfiles)
      .where(eq(talentProfiles.userId, pitch.talentId)).get();

    let knownFor: { title: string; year?: number; type?: string }[] = [];
    try { knownFor = JSON.parse(profile?.knownFor ?? "[]"); } catch { /* empty */ }

    generatedPrompt = await craftCinematicPrompt(env.ANTHROPIC_API_KEY, {
      talentName: profile?.fullName ?? "Actor",
      knownFor,
      characterDescription: pitch.characterDescription,
      tone: pitch.tone,
    });

    await updateStatus(db, pitchId, "prompt_crafting", { generatedPrompt });
  }

  if (!generatedPrompt) {
    generatedPrompt = `Close-up portrait, ${pitch.characterDescription}. ${pitch.tone} aesthetic. Slow push-in, dramatic lighting, cinematic depth of field.`;
    await db.update(pitchVignettes)
      .set({ generatedPrompt })
      .where(eq(pitchVignettes.id, pitchId));
  }

  // ── 2. Resolve source images ──────────────────────────────────────

  await updateStatus(db, pitchId, "submitting");

  let sourceKeys: string[] = [];
  try { sourceKeys = JSON.parse(pitch.sourceImageKeys ?? "[]"); } catch { /* empty */ }

  // Higgsfield pulls images from URLs (input_images[].image_url). Our R2 bucket
  // is private, so we hand it short-lived, HMAC-signed proxy URLs on our own
  // domain (GET /api/pitch/image). No public bucket, no presigned S3 link, no
  // account id in the URL — just a token that authorises one specific object.
  const tokenSecret = env.PITCH_IMAGE_TOKEN_SECRET;
  if (!tokenSecret) {
    await updateStatus(db, pitchId, "failed", {
      error_text: "Pitch vignette generation isn't available yet — image proxy signing isn't configured.",
    });
    return;
  }

  const appUrl = env.APP_URL.replace(/\/$/, "");
  const imageUrls: string[] = [];
  for (const key of sourceKeys.slice(0, 4)) {
    // Skip keys that no longer exist in R2 rather than handing Higgsfield a dead link.
    const head = await env.SCANS_BUCKET.head(key);
    if (!head) continue;
    const token = await signImageToken(tokenSecret, key, SOURCE_URL_TTL_SECS);
    imageUrls.push(`${appUrl}/api/pitch/image?token=${encodeURIComponent(token)}`);
  }

  if (imageUrls.length === 0) {
    await updateStatus(db, pitchId, "failed", { error_text: "No source images available" });
    return;
  }

  // ── 3. Submit to Higgsfield ───────────────────────────────────────

  const { jobId } = await submitVignetteJob(apiKey, {
    imageUrls,
    prompt: generatedPrompt,
    durationSeconds: 10,
    model: env.HIGGSFIELD_MODEL ?? "dop-turbo",
    includeAudio: pitch.includeAudio,
  });

  await updateStatus(db, pitchId, "generating", { higgsfield_job_id: jobId });

  // ── 4. Poll until complete ────────────────────────────────────────

  const MAX_POLLS = 40;  // 40 × 15s = 10 min max
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(15_000);

    const result = await pollVignetteJob(apiKey, jobId);

    if (result.status === "complete" && result.videoUrl) {
      // ── 5. Fetch and store output ─────────────────────────────────
      const videoRes = await fetch(result.videoUrl);
      if (!videoRes.ok) throw new Error(`Video fetch failed ${videoRes.status}`);

      const outputKey = `pitch/${pitchId}/vignette.mp4`;
      await env.SCANS_BUCKET.put(outputKey, videoRes.body!, {
        httpMetadata: { contentType: "video/mp4" },
      });

      await updateStatus(db, pitchId, "complete", {
        output_r2_key: outputKey,
        completed_at: Math.floor(Date.now() / 1000),
      });
      return;
    }

    if (result.status === "failed") {
      await updateStatus(db, pitchId, "failed", {
        error_text: result.error ?? "Higgsfield generation failed",
      });
      return;
    }
  }

  await updateStatus(db, pitchId, "failed", { error_text: "Generation timed out after 10 minutes" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Export ────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;  // mirrors max_retries in higgs-worker/wrangler.toml

async function markPitchFailed(env: Env, pitchId: string, message: string): Promise<void> {
  try {
    await updateStatus(getDb(env), pitchId, "failed", { error_text: message });
  } catch (e) {
    console.error(`[higgs-worker] could not mark pitch ${pitchId} failed:`, e);
  }
}

export default {
  async queue(batch: MessageBatch<PitchMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const pitchId = msg.body.pitchId;
      try {
        await processPitchJob(pitchId, env);
        msg.ack();
      } catch (err) {
        // Transient failures (network, 5xx, rate limit) are retried until the
        // queue's retry budget is spent; terminal ones (bad key, 4xx, bad
        // response) fail fast. Either way, once we stop retrying we surface a
        // "failed" status so the pitch never sits stuck mid-generation.
        const retryable = err instanceof HiggsfieldError ? err.retryable : true;
        const exhausted = msg.attempts > MAX_RETRIES;
        console.error(
          `[higgs-worker] pitch ${pitchId} failed (attempt ${msg.attempts}, retryable=${retryable}):`,
          err
        );

        if (retryable && !exhausted) {
          msg.retry();
        } else {
          const message = err instanceof Error ? err.message : "Pitch vignette generation failed.";
          await markPitchFailed(env, pitchId, message);
          msg.ack();
        }
      }
    }
  },
} satisfies ExportedHandler<Env, PitchMessage>;
