// Enforcement hooks (SPEC §16.11).
//
// A single guard the hot paths (royalty meter, dual-custody download, access
// windows, bridge grants) call before allowing an action. Slice 4 implements the
// 39.G strike check; a blocked action also appends a `use.blocked_by_strike`
// event to the licence chain so the block itself is auditable.

import { and, desc, eq, or } from "drizzle-orm";
import { appendEvent, licenceChain } from "./ledger";
import { licences, strikeLocks } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface StrikeBlock {
  strikeId: string;
  scope: string;
  reason: string;
}

// Return the most recent active strike covering this licence, or null.
// Covered when a strike is global, or scoped to the licence / its organisation /
// its production.
export async function findCoveringStrike(db: Db, licenceId: string): Promise<StrikeBlock | null> {
  const lic = await db
    .select({ organisationId: licences.organisationId, productionId: licences.productionId })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  const scopeMatches = [
    eq(strikeLocks.scope, "global"),
    and(eq(strikeLocks.scope, "licence"), eq(strikeLocks.scopeId, licenceId)),
  ];
  if (lic?.organisationId) {
    scopeMatches.push(and(eq(strikeLocks.scope, "organisation"), eq(strikeLocks.scopeId, lic.organisationId)));
  }
  if (lic?.productionId) {
    scopeMatches.push(and(eq(strikeLocks.scope, "production"), eq(strikeLocks.scopeId, lic.productionId)));
  }

  const strike = await db
    .select({ id: strikeLocks.id, scope: strikeLocks.scope, reason: strikeLocks.reason })
    .from(strikeLocks)
    .where(and(eq(strikeLocks.status, "active"), or(...scopeMatches)))
    .orderBy(desc(strikeLocks.declaredAt))
    .limit(1)
    .get();

  return strike ? { strikeId: strike.id, scope: strike.scope, reason: strike.reason } : null;
}

// Guard for a use/download/meter action. If a covering strike is active, records
// the blocked attempt (use.blocked_by_strike, 39.G) and returns the block;
// otherwise returns null and the caller proceeds.
export async function assertNoActiveStrike(
  db: Db,
  args: {
    licenceId: string;
    talentId?: string | null;
    organisationId?: string | null;
    actorId?: string | null;
    action?: string;
  },
): Promise<StrikeBlock | null> {
  const block = await findCoveringStrike(db, args.licenceId);
  if (!block) return null;

  await appendEvent(db, {
    chainKey: licenceChain(args.licenceId),
    eventType: "use.blocked_by_strike",
    clauseRef: "39.G",
    licenceId: args.licenceId,
    talentId: args.talentId ?? null,
    organisationId: args.organisationId ?? null,
    actorId: args.actorId ?? null,
    payload: { strikeId: block.strikeId, scope: block.scope, reason: block.reason, action: args.action ?? null },
  });

  return block;
}
