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
import { submitVignetteJob, pollVignetteJob } from "./higgs-client";

interface Env {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  ANTHROPIC_API_KEY?: string;
  HIGGSFIELD_API_KEY?: string;
  HIGGSFIELD_MODEL?: string;
  APP_URL: string;
}

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

// ── R2 image fetch helper ─────────────────────────────────────────────────────
// Higgsfield accepts image URLs. Since R2 Workers bindings can't generate
// presigned URLs directly, we read the image bytes and re-upload them to
// Higgsfield's image upload endpoint first, then pass the returned URL.
// TODO: if your R2 bucket is public or behind a CDN, replace this with a direct URL.

async function fetchImageAsBase64(bucket: R2Bucket, key: string): Promise<{ base64: string; contentType: string } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;

  const bytes = await obj.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const contentType = obj.httpMetadata?.contentType ?? "image/jpeg";
  return { base64, contentType };
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

  const apiKey = env.HIGGSFIELD_API_KEY;
  if (!apiKey) throw new Error("HIGGSFIELD_API_KEY not set");

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

  // Upload source images to Higgsfield image store, collect returned URLs
  // TODO: if R2 bucket is public, skip upload and pass direct bucket URLs instead
  const imageUrls: string[] = [];
  for (const key of sourceKeys.slice(0, 4)) {
    const img = await fetchImageAsBase64(env.SCANS_BUCKET, key);
    if (!img) continue;

    // Upload image to Higgsfield via their image upload endpoint
    // TODO: Confirm exact upload endpoint from Higgsfield API docs
    const uploadRes = await fetch(`https://api.higgsfield.ai/v1/images/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image: `data:${img.contentType};base64,${img.base64}` }),
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json() as { url?: string; image_url?: string; id?: string };
      const imageUrl = uploadData.url ?? uploadData.image_url;
      if (imageUrl) imageUrls.push(imageUrl);
    } else {
      // Fallback: some Higgsfield models accept base64 data URIs directly in the prompt
      imageUrls.push(`data:${img.contentType};base64,${img.base64}`);
    }
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
    model: env.HIGGSFIELD_MODEL ?? "kling-3.0",
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

export default {
  async queue(batch: MessageBatch<PitchMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processPitchJob(msg.body.pitchId, env);
        msg.ack();
      } catch (err) {
        console.error(`[higgs-worker] pitch ${msg.body.pitchId} failed:`, err);
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, PitchMessage>;
