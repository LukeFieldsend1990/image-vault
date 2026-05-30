// Transfer protection / escrow (SPEC §16.10) — Article 39.I.
//
// A producer requests a third-party transfer; an admin (acting as Union escrow)
// approves or denies. Producer stays liable unless the transferee is
// Union-approved, so the decision records `unionApproved`. Each step is a ledger
// event on the licence chain.

import { desc, eq } from "drizzle-orm";
import { appendEvent, licenceChain } from "./ledger";
import { replicaTransfers } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

export interface RequestTransferParams {
  licenceId: string;
  fromOrganisationId?: string | null;
  toPartyName: string;
  toPartyDetails?: unknown;
  requestedBy: string;
  ip?: string | null;
  ua?: string | null;
}

export async function requestTransfer(db: Db, p: RequestTransferParams): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(replicaTransfers).values({
    id,
    licenceId: p.licenceId,
    fromOrganisationId: p.fromOrganisationId ?? null,
    toPartyName: p.toPartyName,
    toPartyDetailsJson: safeStringify(p.toPartyDetails),
    unionApproved: false,
    status: "requested",
    requestedBy: p.requestedBy,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: now,
  });

  await appendEvent(db, {
    chainKey: licenceChain(p.licenceId),
    eventType: "transfer.requested",
    clauseRef: "39.I",
    licenceId: p.licenceId,
    organisationId: p.fromOrganisationId ?? null,
    actorId: p.requestedBy,
    payload: { transferId: id, toPartyName: p.toPartyName },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });

  return { id };
}

export interface DecideTransferParams {
  id: string;
  decision: "approved" | "denied";
  unionApproved: boolean;
  decidedBy: string;
  note?: string | null;
  ip?: string | null;
  ua?: string | null;
}

export async function decideTransfer(
  db: Db,
  p: DecideTransferParams,
): Promise<{ id: string; status: "approved" | "denied" } | null> {
  const transfer = await db
    .select({ id: replicaTransfers.id, licenceId: replicaTransfers.licenceId, status: replicaTransfers.status })
    .from(replicaTransfers)
    .where(eq(replicaTransfers.id, p.id))
    .get();
  if (!transfer || transfer.status !== "requested") return null;

  const unionApproved = p.decision === "approved" ? p.unionApproved : false;

  await db
    .update(replicaTransfers)
    .set({
      status: p.decision,
      unionApproved,
      decidedBy: p.decidedBy,
      decidedAt: Math.floor(Date.now() / 1000),
      decisionNote: p.note ?? null,
    })
    .where(eq(replicaTransfers.id, p.id));

  await appendEvent(db, {
    chainKey: licenceChain(transfer.licenceId),
    eventType: p.decision === "approved" ? "transfer.approved" : "transfer.denied",
    clauseRef: "39.I",
    licenceId: transfer.licenceId,
    actorId: p.decidedBy,
    payload: { transferId: p.id, unionApproved, note: p.note ?? null },
    ipAddress: p.ip ?? null,
    userAgent: p.ua ?? null,
  });

  return { id: p.id, status: p.decision };
}

export async function listTransfers(db: Db, licenceId: string) {
  return db
    .select()
    .from(replicaTransfers)
    .where(eq(replicaTransfers.licenceId, licenceId))
    .orderBy(desc(replicaTransfers.createdAt))
    .all();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}).slice(0, 4000);
  } catch {
    return "{}";
  }
}
