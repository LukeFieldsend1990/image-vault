/**
 * Live sweep progress.
 *
 * A real sweep chains several 1-3 minute Apify runs, then three AI passes —
 * long enough that "Scanning…" with a spinner reads as a hang. The reporter
 * keeps a progress snapshot on the scan row itself (stage, per-platform
 * status, a short activity log) so the poll endpoint can narrate the sweep as
 * it actually happens.
 *
 * Design constraints:
 *  - Non-fatal everywhere. A progress write must never fail a sweep, so every
 *    D1 write is caught and dropped. The snapshot is a courtesy, not a ledger.
 *  - Writes are chained, not awaited by callers. Each call mutates in-memory
 *    state synchronously and queues one serialised write of the whole
 *    snapshot; the chain keeps a slow write from persisting stale state over
 *    a newer one.
 *  - The log is talent-facing copy. Entries appear verbatim in the monitor
 *    page's activity feed, so they describe what the sweep is doing for the
 *    talent — never internal diagnostics (those stay on console.warn).
 */

import { getDb } from "@/lib/db";
import { monitorScans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { MonitorPlatformId } from "./platforms";

type Db = ReturnType<typeof getDb>;

export type ScanStage =
  | "preparing"
  | "discovering"
  | "matching"
  | "verifying"
  | "adjudicating"
  | "finalizing";

export type PlatformSweepStatus = "pending" | "sweeping" | "done";

export interface PlatformProgress {
  status: PlatformSweepStatus;
  /** Candidates the platform contributed; null until its sweep settles. */
  candidates: number | null;
}

export interface ScanProgress {
  stage: ScanStage;
  stageLabel: string;
  platforms: Partial<Record<MonitorPlatformId, PlatformProgress>>;
  candidatesFound: number;
  log: { at: number; text: string }[];
  updatedAt: number;
}

/** Oldest entries drop off first; the feed only ever shows the recent tail. */
const LOG_CAP = 40;

export interface ScanReporter {
  /** Enter a stage. The label is what the UI shows while the stage runs. */
  stage(stage: ScanStage, label: string): void;
  /** Mark one platform's sweep state; candidates settle it. */
  platform(id: MonitorPlatformId, status: PlatformSweepStatus, candidates?: number): void;
  /** Append one talent-facing line to the activity feed. */
  note(text: string): void;
  /** Running total shown while candidates accumulate across platforms. */
  candidates(total: number): void;
  /** Wait for queued writes — call once before the final status flip. */
  flush(): Promise<void>;
}

/** For callers that run a sweep without a row to report against (tests). */
export const NOOP_REPORTER: ScanReporter = {
  stage: () => {},
  platform: () => {},
  note: () => {},
  candidates: () => {},
  flush: async () => {},
};

export function createScanReporter(
  db: Db,
  scanId: string,
  enabledPlatforms: Iterable<MonitorPlatformId>
): ScanReporter {
  const state: ScanProgress = {
    stage: "preparing",
    stageLabel: "Preparing sweep",
    platforms: {},
    candidatesFound: 0,
    log: [],
    updatedAt: Math.floor(Date.now() / 1000),
  };
  for (const id of enabledPlatforms) {
    state.platforms[id] = { status: "pending", candidates: null };
  }

  // Serialised write chain: state is mutated synchronously, then one write of
  // the full snapshot joins the queue. Never rejects — a failed write logs and
  // the chain continues, so a D1 hiccup costs one snapshot, not the sweep.
  let chain: Promise<void> = Promise.resolve();
  const persist = () => {
    state.updatedAt = Math.floor(Date.now() / 1000);
    const snapshot = JSON.stringify(state);
    chain = chain.then(async () => {
      try {
        await db
          .update(monitorScans)
          .set({ progressJson: snapshot })
          .where(eq(monitorScans.id, scanId));
      } catch (err) {
        console.warn(`[monitor] progress write failed for ${scanId}: ${(err as Error).message}`);
      }
    });
  };

  return {
    stage(stage, label) {
      state.stage = stage;
      state.stageLabel = label;
      persist();
    },
    platform(id, status, candidates) {
      state.platforms[id] = {
        status,
        candidates: candidates ?? state.platforms[id]?.candidates ?? null,
      };
      persist();
    },
    note(text) {
      state.log.push({ at: Math.floor(Date.now() / 1000), text });
      if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
      persist();
    },
    candidates(total) {
      state.candidatesFound = total;
      persist();
    },
    flush() {
      return chain;
    },
  };
}

export function parseScanProgress(json: string | null | undefined): ScanProgress | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ScanProgress;
    if (!parsed || typeof parsed !== "object" || typeof parsed.stage !== "string") return null;
    return {
      stage: parsed.stage,
      stageLabel: typeof parsed.stageLabel === "string" ? parsed.stageLabel : "",
      platforms: parsed.platforms && typeof parsed.platforms === "object" ? parsed.platforms : {},
      candidatesFound: typeof parsed.candidatesFound === "number" ? parsed.candidatesFound : 0,
      log: Array.isArray(parsed.log)
        ? parsed.log.filter((e) => e && typeof e.text === "string" && typeof e.at === "number")
        : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}
