/**
 * Probe-grade reference selection.
 *
 * Probe identity scoring must run against clean references — frontal, single
 * face, well-lit — or the control baseline is corrupted by capture stills with
 * a technician in frame. `probe_grade` on monitor_reference_images marks those.
 * This module is the one place that reads that flag, shared by the app-side
 * cost estimate and the worker's scoring loop so they always agree on which
 * references a run uses.
 */

import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { monitorReferenceImages } from "@/lib/db/schema";

type Db = ReturnType<typeof getDb>;

export interface ProbeReference {
  scanFileId: string;
  r2Key: string;
  kind: string;
}

/** Active, probe-grade references for a talent. */
export async function getProbeReferences(db: Db, talentId: string): Promise<ProbeReference[]> {
  const rows = await db
    .select({
      scanFileId: monitorReferenceImages.scanFileId,
      r2Key: monitorReferenceImages.r2Key,
      kind: monitorReferenceImages.kind,
    })
    .from(monitorReferenceImages)
    .where(
      and(
        eq(monitorReferenceImages.talentId, talentId),
        eq(monitorReferenceImages.status, "active"),
        eq(monitorReferenceImages.probeGrade, true)
      )
    )
    .all();
  return rows.map((r) => ({ scanFileId: r.scanFileId, r2Key: r.r2Key, kind: r.kind }));
}

export async function countProbeReferences(db: Db, talentId: string): Promise<number> {
  const refs = await getProbeReferences(db, talentId);
  return refs.length;
}
