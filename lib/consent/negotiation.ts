/**
 * Licence-negotiation thread helpers.
 *
 * The producer's initial offer is the licence itself (useCategoriesJson +
 * proposedFee). Each subsequent round is a row in licence_negotiations. A
 * talent/rep `counter` is a conditional consent; the producer accepting it (or
 * the talent confirming the producer's current offer on the consent document)
 * finalises the terms.
 */

import { licenceNegotiations } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { normaliseUseCategoryIds, type UseCategoryId } from "./use-categories";

type Db = ReturnType<typeof getDb>;

export type NegotiationParty = "producer" | "talent" | "rep";
export type NegotiationAction = "counter" | "accepted" | "declined";

export interface NegotiationRound {
  id: string;
  round: number;
  party: NegotiationParty;
  action: NegotiationAction;
  scope: UseCategoryId[];
  fee: number | null; // pence
  comment: string | null;
  createdAt: number;
}

export async function listNegotiationRounds(db: Db, licenceId: string): Promise<NegotiationRound[]> {
  const rows = await db
    .select()
    .from(licenceNegotiations)
    .where(eq(licenceNegotiations.licenceId, licenceId))
    .orderBy(asc(licenceNegotiations.round))
    .all();
  return rows.map((r) => ({
    id: r.id,
    round: r.round,
    party: r.party,
    action: r.action,
    scope: normaliseUseCategoryIds(safeParse(r.proposedScopeJson)),
    fee: r.proposedFee ?? null,
    comment: r.comment ?? null,
    createdAt: r.createdAt,
  }));
}

export async function addNegotiationRound(
  db: Db,
  input: {
    licenceId: string;
    party: NegotiationParty;
    action: NegotiationAction;
    scope?: string[];
    fee?: number | null;
    comment?: string | null;
    createdBy: string;
  },
): Promise<NegotiationRound> {
  const existing = await listNegotiationRounds(db, input.licenceId);
  const round = existing.length + 1;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.insert(licenceNegotiations).values({
    id,
    licenceId: input.licenceId,
    round,
    party: input.party,
    action: input.action,
    proposedScopeJson: input.scope ? JSON.stringify(normaliseUseCategoryIds(input.scope)) : null,
    proposedFee: input.fee ?? null,
    comment: input.comment?.trim() || null,
    createdBy: input.createdBy,
    createdAt: now,
  });
  return {
    id,
    round,
    party: input.party,
    action: input.action,
    scope: normaliseUseCategoryIds(input.scope ?? []),
    fee: input.fee ?? null,
    comment: input.comment?.trim() || null,
    createdAt: now,
  };
}

/** The most recent open counter from the talent side (a proposal awaiting the producer). */
export function latestTalentCounter(rounds: NegotiationRound[]): NegotiationRound | null {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (r.action === "counter" && (r.party === "talent" || r.party === "rep")) return r;
    if (r.action === "accepted" || r.action === "declined") return null; // thread closed
  }
  return null;
}

/** True once a round has closed the thread. */
export function isThreadClosed(rounds: NegotiationRound[]): boolean {
  const last = rounds[rounds.length - 1];
  return Boolean(last && (last.action === "accepted" || last.action === "declined"));
}

function safeParse(json: string | null): unknown {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}
