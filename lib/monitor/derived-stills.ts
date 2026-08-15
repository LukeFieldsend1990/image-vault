/**
 * App-side trigger for the derived-stills job (pipeline-worker).
 *
 * A package with no photographic stills — mesh + textures only, or a 360°
 * reference video — contributes nothing to the reference gallery and scores
 * "unanchored" no matter how premium the scan. The derived-stills job fixes
 * that by producing reference stills from what the package does have:
 * frame grabs from a turntable video (photographic, preferred) or three.js
 * turntable renders of the mesh. This module only decides and enqueues;
 * rendering happens in pipeline-worker/src/derived-stills.ts.
 */

import { and, eq, inArray } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { getDb } from "@/lib/db";
import { derivedRenderJobs, scanFiles } from "@/lib/db/schema";
import { isReferenceCandidate } from "./reference-set";

type Db = ReturnType<typeof getDb>;

export interface DerivedStillsDecision {
  enqueued: boolean;
  reason:
    | "queued"
    | "has_photographic_references"
    | "no_render_source"
    | "job_already_exists"
    | "queue_unavailable";
}

/**
 * Enqueue a derived-stills render for this package if (and only if) it has
 * no photographic reference candidates but does carry a renderable source
 * (OBJ mesh or MP4 turntable video). Idempotent against already-queued,
 * running, or completed jobs; a failed or skipped job may be retried.
 */
export async function maybeEnqueueDerivedStills(
  db: Db,
  packageId: string
): Promise<DerivedStillsDecision> {
  const files = await db
    .select({
      filename: scanFiles.filename,
      contentType: scanFiles.contentType,
      sizeBytes: scanFiles.sizeBytes,
      r2Key: scanFiles.r2Key,
    })
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
    .all();

  // Existing derived stills also count as reference candidates, so a
  // package that already rendered won't re-qualify.
  if (files.some((f) => isReferenceCandidate(f))) {
    return { enqueued: false, reason: "has_photographic_references" };
  }

  const hasSource = files.some((f) => /\.(obj|mp4)$/i.test(f.filename));
  if (!hasSource) {
    return { enqueued: false, reason: "no_render_source" };
  }

  const existing = await db
    .select({ id: derivedRenderJobs.id })
    .from(derivedRenderJobs)
    .where(
      and(
        eq(derivedRenderJobs.packageId, packageId),
        inArray(derivedRenderJobs.status, ["queued", "running", "complete"])
      )
    )
    .get();
  if (existing) {
    return { enqueued: false, reason: "job_already_exists" };
  }

  try {
    const { env } = getCloudflareContext();
    const queue = (env as unknown as Record<string, Queue | undefined>)["PIPELINE_QUEUE"];
    if (!queue) return { enqueued: false, reason: "queue_unavailable" };
    await db.insert(derivedRenderJobs).values({
      id: crypto.randomUUID(),
      packageId,
      status: "queued",
      createdAt: Math.floor(Date.now() / 1000),
    });
    await queue.send({ task: "derived_stills", packageId });
    return { enqueued: true, reason: "queued" };
  } catch {
    // Queue not available in local dev.
    return { enqueued: false, reason: "queue_unavailable" };
  }
}
