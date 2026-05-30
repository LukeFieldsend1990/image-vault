// Strike locks (SPEC §16.8) — SAG-AFTRA Article 39.G.
//
// An admin declares a strike scoped to global / organisation / production /
// licence; while active it freezes every covered replica (enforcement lives in
// enforce.ts). strike_locks is the source of truth for enforcement; each
// declare/lift also appends to a self-contained `strike:{id}` ledger chain for
// the audit trail.

import { desc, eq } from "drizzle-orm";
import { appendEvent } from "./ledger";
import { strikeLocks } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export type StrikeScope = "global" | "organisation" | "production" | "licence";

const strikeChain = (id: string) => `strike:${id}`;

export interface DeclareStrikeParams {
  scope: StrikeScope;
  scopeId?: string | null; // required unless scope === 'global'
  reason: string;
  declaredBy: string;
  ip?: string | null;
  ua?: string | null;
}

export async function declareStrike(db: Db, p: DeclareStrikeParams): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const scopeId = p.scope === "global" ? null : (p.scopeId ?? null);

  await db.insert(strikeLocks).values({
    id,
    scope: p.scope,
    scopeId,
    reason: p.reason,
    declaredBy: p.declaredBy,
    declaredAt: now,
    liftedBy: null,
    liftedAt: null,
    status: "active",
  });

  await appendEvent(db, {
    chainKey: strikeChain(id),
    eventType: "strike.declared",
    clauseRef: "39.G",
    actorId: p.declaredBy,
    payload: { scope: p.scope, scopeId, reason: p.reason },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });

  return { id };
}

export async function liftStrike(
  db: Db,
  args: { id: string; liftedBy: string; ip?: string | null; ua?: string | null },
): Promise<boolean> {
  const strike = await db
    .select({ id: strikeLocks.id, status: strikeLocks.status })
    .from(strikeLocks)
    .where(eq(strikeLocks.id, args.id))
    .get();
  if (!strike || strike.status !== "active") return false;

  await db
    .update(strikeLocks)
    .set({ status: "lifted", liftedBy: args.liftedBy, liftedAt: Math.floor(Date.now() / 1000) })
    .where(eq(strikeLocks.id, args.id));

  await appendEvent(db, {
    chainKey: strikeChain(args.id),
    eventType: "strike.lifted",
    clauseRef: "39.G",
    actorId: args.liftedBy,
    payload: {},
    ipAddress: args.ip ?? null,
    userAgent: args.ua ?? null,
  });

  return true;
}

// Most-recent-first list of all strikes (active + lifted) for the admin console.
export async function listStrikes(db: Db) {
  return db.select().from(strikeLocks).orderBy(desc(strikeLocks.declaredAt)).all();
}
