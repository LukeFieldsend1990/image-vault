/**
 * Fire-and-forget re-indexing helper for API routes.
 *
 * Call `triggerReindex(packageId)` after any mutation that changes
 * a package's tags, metadata, or soft-delete status.
 */

import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { indexPackage, removePackage } from "./index";

/**
 * Re-index a package in Vectorize (fire-and-forget).
 * Safe to call from any API route — failures are logged, not thrown.
 */
export function triggerReindex(packageId: string): void {
  void (async () => {
    try {
      const { env } = getRequestContext();
      if (!env.VECTORIZE || !env.AI) return; // bindings not available (local dev)
      const db = getDb();
      await indexPackage(env, db, packageId);
    } catch (err) {
      console.error(`[search] reindex failed for ${packageId}:`, err);
    }
  })();
}

/**
 * Remove a package from the Vectorize index (fire-and-forget).
 */
export function triggerRemoveIndex(packageId: string): void {
  void (async () => {
    try {
      const { env } = getRequestContext();
      if (!env.VECTORIZE) return;
      await removePackage(env, packageId);
    } catch (err) {
      console.error(`[search] remove index failed for ${packageId}:`, err);
    }
  })();
}
