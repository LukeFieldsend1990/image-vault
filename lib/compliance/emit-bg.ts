// Edge-safe, fire-and-forget compliance-ledger append.
//
// Kept in its own module (separate from lib/compliance/ledger) so the core
// ledger stays free of the Cloudflare adapter import — the compliance unit tests
// import ledger directly and mock @opennextjs/cloudflare, and a static import of
// the adapter there trips vitest's mock hoisting. Only route handlers import this.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { appendEvent, type AppendEventSpec } from "./ledger";
import { recordAppendFailure } from "./failures";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

// Re-exported for convenience so a handler can pull the chain-key helper and the
// background emitter from one place.
export { licenceChain, talentChain } from "./ledger";

// Append an audit-only lifecycle event (denial, revocation, scrub, package
// attach, counter-offer) without blocking or failing the response. Wrapped in
// ctx.waitUntil so the write survives past the response on the edge; non-fatal —
// a failed append never throws into the caller.
//
// Non-fatal is not the same as unrecorded. A dropped append cannot be found
// later: `appendEvent` takes `seq` from the tip at write time, so an event that
// was never written leaves a chain that is shorter than it should be yet still
// verifies — no gap, no hash break, nothing to detect. So a failure here is
// written to the dead-letter table (lib/compliance/failures.ts), where it stays
// visible and replayable, rather than being discarded.
export function appendEventBg(db: Db, spec: AppendEventSpec): void {
  const work = (async () => {
    try {
      await appendEvent(db, spec);
    } catch (err) {
      // appendEvent already retried the racing-seq case internally, so reaching
      // here means the append genuinely could not be written.
      await recordAppendFailure(db, spec, err);
    }
  })();
  try {
    getCloudflareContext().ctx.waitUntil(work);
  } catch {
    void work; // local dev / no request context
  }
}
