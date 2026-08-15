/**
 * Derived reference stills for mesh/video-only scan packages.
 *
 * A package with no photographic stills anchors nothing in the likeness
 * monitor (docs/deepfake-detection.md, limitation 3). This job produces
 * reference stills from what the package does carry, preferring the
 * package's 360°/turntable reference MP4 (frame grabs are photographic —
 * strictly better references than any render) and falling back to a
 * three.js turntable of the OBJ mesh via Cloudflare Browser Rendering.
 *
 * Degradation contract: no BROWSER binding, no R2 API credentials, or no
 * renderable source → the job records 'skipped' and never fails the queue
 * message. Renders land in R2 under derived/<packageId>/ with filenames
 * that pass the reference-set classifier, are inserted as scan_files rows
 * (so syncReferenceSet picks them up with zero query changes), and are
 * hashed straight into the monitor's pHash derivation index.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, like } from "drizzle-orm";
import { AwsClient } from "aws4fetch";
import puppeteer from "@cloudflare/puppeteer";
import { derivedRenderJobs, monitorPhashIndex, scanFiles, scanPackages, talentBodyProfiles } from "./schema";
import { PHASH_ALGORITHM, hashPng } from "./phash";
import { BODY_METRICS_ALGORITHM, computeBodyMetrics } from "./body-metrics";

export interface DerivedStillsEnv {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  APP_URL: string;
  BROWSER?: Fetcher;
  CF_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

const MAX_OBJ_BYTES = 150_000_000;
const RENDER_TIMEOUT_MS = 90_000;
const LOD_PREFERENCE = ["_lr", "_mr", "_hr"];

async function presignScanUrl(env: DerivedStillsEnv, r2Key: string): Promise<string | null> {
  if (!env.CF_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  const bucket = env.R2_BUCKET_NAME ?? "image-vault-scans";
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: "auto",
    service: "s3",
  });
  const url = new URL(`https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${r2Key}`);
  url.searchParams.set("X-Amz-Expires", "1200");
  const signed = await client.sign(new Request(url.toString(), { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Prefer the smallest MP4 (photographic frames); else the lowest-LOD OBJ
 *  under the size cap. */
function pickRenderSource(
  files: { filename: string; sizeBytes: number; r2Key: string }[]
): { file: { filename: string; sizeBytes: number; r2Key: string }; mode: "video" | "obj" } | null {
  const videos = files
    .filter((f) => /\.mp4$/i.test(f.filename))
    .sort((a, b) => a.sizeBytes - b.sizeBytes);
  if (videos.length) return { file: videos[0], mode: "video" };

  const objs = files
    .filter((f) => /\.obj$/i.test(f.filename) && f.sizeBytes <= MAX_OBJ_BYTES)
    .sort((a, b) => {
      const rank = (name: string) => {
        const lower = name.toLowerCase();
        const i = LOD_PREFERENCE.findIndex((hint) => lower.includes(hint));
        return i === -1 ? LOD_PREFERENCE.length : i;
      };
      return rank(a.filename) - rank(b.filename) || a.sizeBytes - b.sizeBytes;
    });
  if (objs.length) return { file: objs[0], mode: "obj" };
  return null;
}

const BODY_OBJ_HINTS = /(body|full[-_ ]?body|figure|stance|a[-_ ]?pose|t[-_ ]?pose|standing|silhouette)/i;
const MAX_BODY_OBJ_BYTES = 150_000_000;

/** Compute and upsert the talent's body profile from a full-body OBJ, if
 *  the package carries one and no profile exists yet. */
async function maybeComputeBodyProfile(
  env: DerivedStillsEnv,
  db: ReturnType<typeof drizzle>,
  talentId: string,
  packageId: string,
  files: { filename: string; sizeBytes: number; r2Key: string }[]
): Promise<void> {
  const bodyObj = files
    .filter(
      (f) =>
        /\.obj$/i.test(f.filename) && BODY_OBJ_HINTS.test(f.filename) && f.sizeBytes <= MAX_BODY_OBJ_BYTES
    )
    .sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  if (!bodyObj) return;

  const existing = await db
    .select({ talentId: talentBodyProfiles.talentId })
    .from(talentBodyProfiles)
    .where(eq(talentBodyProfiles.talentId, talentId))
    .get();
  if (existing) return;

  const metrics = await computeBodyMetrics(async () => {
    const object = await env.SCANS_BUCKET.get(bodyObj.r2Key);
    return object?.body ?? null;
  });
  if (!metrics) return;

  await db.insert(talentBodyProfiles).values({
    talentId,
    packageId,
    algorithm: BODY_METRICS_ALGORITHM,
    metricsJson: JSON.stringify(metrics),
    computedAt: Math.floor(Date.now() / 1000),
  });
  console.log(`[derived-stills] body profile computed for talent ${talentId} from ${bodyObj.filename}`);
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !dataUrl.startsWith("data:image/png;base64,")) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function processDerivedStills(env: DerivedStillsEnv, packageId: string): Promise<void> {
  const db = drizzle(env.DB);
  const now = () => Math.floor(Date.now() / 1000);

  // Claim the queued row the app inserted, or open one for manual sends.
  const queued = await db
    .select({ id: derivedRenderJobs.id })
    .from(derivedRenderJobs)
    .where(and(eq(derivedRenderJobs.packageId, packageId), eq(derivedRenderJobs.status, "queued")))
    .get();
  const jobId = queued?.id ?? crypto.randomUUID();
  if (queued) {
    await db
      .update(derivedRenderJobs)
      .set({ status: "running" })
      .where(eq(derivedRenderJobs.id, jobId));
  } else {
    await db.insert(derivedRenderJobs).values({
      id: jobId,
      packageId,
      status: "running",
      createdAt: now(),
    });
  }

  const close = async (
    status: "complete" | "failed" | "skipped",
    fields: { strategy?: "video_frames" | "mesh_turntable"; stillsCreated?: number; error?: string } = {}
  ) => {
    await db
      .update(derivedRenderJobs)
      .set({ status, completedAt: now(), ...fields })
      .where(eq(derivedRenderJobs.id, jobId));
  };

  try {
    // Idempotency: a completed job or existing derived stills mean the work
    // is already done — this message is a duplicate.
    const priorComplete = await db
      .select({ id: derivedRenderJobs.id })
      .from(derivedRenderJobs)
      .where(and(eq(derivedRenderJobs.packageId, packageId), eq(derivedRenderJobs.status, "complete")))
      .get();
    const existingDerived = await db
      .select({ id: scanFiles.id })
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, packageId), like(scanFiles.r2Key, `derived/${packageId}/%`)))
      .get();
    if (priorComplete || existingDerived) {
      await close("skipped", { error: "derived stills already exist" });
      return;
    }

    const pkg = await db
      .select({ talentId: scanPackages.talentId })
      .from(scanPackages)
      .where(eq(scanPackages.id, packageId))
      .get();
    if (!pkg) {
      await close("failed", { error: "package not found" });
      return;
    }

    const files = await db
      .select({ filename: scanFiles.filename, sizeBytes: scanFiles.sizeBytes, r2Key: scanFiles.r2Key })
      .from(scanFiles)
      .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
      .all();

    // Body-geometry context rides this job but needs no browser: a
    // streaming width-profile over the full-body OBJ, upserted per talent.
    // Best-effort — a failure here never touches the render outcome.
    try {
      await maybeComputeBodyProfile(env, db, pkg.talentId, packageId, files);
    } catch (err) {
      console.warn(
        `[derived-stills] body metrics failed for ${packageId}: ${err instanceof Error ? err.message : err}`
      );
    }

    const source = pickRenderSource(files);
    if (!source) {
      await close("skipped", { error: "no renderable source (mp4/obj)" });
      return;
    }
    const strategy = source.mode === "video" ? "video_frames" : "mesh_turntable";

    if (!env.BROWSER) {
      await close("skipped", { strategy, error: "browser rendering binding absent" });
      return;
    }
    const srcUrl = await presignScanUrl(env, source.file.r2Key);
    if (!srcUrl) {
      await close("skipped", { strategy, error: "R2 API credentials absent" });
      return;
    }

    const browser = await puppeteer.launch(env.BROWSER);
    let frames: { name: string; dataUrl: string }[];
    try {
      const page = await browser.newPage();
      const pageUrl = `${env.APP_URL}/turntable.html?src=${encodeURIComponent(srcUrl)}&mode=${source.mode}`;
      await page.goto(pageUrl, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      await page.waitForFunction("window.__framesReady === true", { timeout: RENDER_TIMEOUT_MS });
      const result = (await page.evaluate(
        "({ frames: window.__frames, error: window.__error })"
      )) as { frames?: { name: string; dataUrl: string }[]; error?: string };
      if (result.error) throw new Error(`render page: ${result.error}`);
      frames = result.frames ?? [];
    } finally {
      await browser.close();
    }
    if (!frames.length) throw new Error("render page produced no frames");

    let created = 0;
    for (const frame of frames) {
      const bytes = dataUrlToBytes(frame.dataUrl);
      if (!bytes || bytes.length < 20_000) continue; // must pass isReferenceCandidate
      const r2Key = `derived/${packageId}/${frame.name}`;
      await env.SCANS_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: "image/png" },
      });
      const fileId = crypto.randomUUID();
      await db.insert(scanFiles).values({
        id: fileId,
        packageId,
        filename: frame.name,
        sizeBytes: bytes.length,
        r2Key,
        contentType: "image/png",
        uploadStatus: "complete",
        createdAt: now(),
        completedAt: now(),
      });
      // Hash straight into the derivation index while the bytes are in hand.
      const hashed = hashPng(bytes);
      await db
        .insert(monitorPhashIndex)
        .values({
          id: crypto.randomUUID(),
          talentId: pkg.talentId,
          packageId,
          scanFileId: fileId,
          r2Key,
          source: "derived_render",
          algorithm: PHASH_ALGORITHM,
          hashHex: hashed?.hashHex ?? null,
          width: hashed?.width ?? null,
          height: hashed?.height ?? null,
          status: hashed ? "hashed" : "failed",
          createdAt: now(),
        })
        .onConflictDoNothing();
      created += 1;
    }

    if (created === 0) throw new Error("no frames survived decode/size checks");
    await close("complete", { strategy, stillsCreated: created });
    console.log(`[derived-stills] package ${packageId}: ${created} stills via ${strategy}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await close("failed", { error: message });
    console.error(`[derived-stills] package ${packageId} failed: ${message}`);
  }
}
