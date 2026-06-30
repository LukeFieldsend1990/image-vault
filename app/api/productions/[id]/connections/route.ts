import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orgConnections } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import {
  getManagedOrgIds,
  getProductionParties,
  isPartyTo,
  offerConnection,
  counterpartyOrgId,
  isVisibilityTier,
  type ConnectionRow,
  type VisibilityTier,
} from "@/lib/organisations/connections";
import { and, eq, or, inArray } from "drizzle-orm";
import { sendConnectionOfferNotification } from "@/lib/organisations/connection-notify";

// The caller's party orgs on this production (orgs they manage that are party).
async function callerParties(db: ReturnType<typeof getDb>, userId: string, productionId: string) {
  const [managed, parties] = await Promise.all([
    getManagedOrgIds(db, userId),
    getProductionParties(db, productionId),
  ]);
  const managedParties = managed.filter((id) => isPartyTo(parties, id));
  return { managed, parties, managedParties };
}

// GET /api/productions/[id]/connections — connections on this production that
// involve one of the caller's party orgs, from their perspective. Drives the
// per-vendor connect state on the production vendor panel.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { managedParties } = await callerParties(db, session.sub, id);
  if (managedParties.length === 0) return NextResponse.json({ connections: [] });

  const rows = await db
    .select()
    .from(orgConnections)
    .where(
      and(
        eq(orgConnections.productionId, id),
        or(inArray(orgConnections.orgAId, managedParties), inArray(orgConnections.orgBId, managedParties)),
      ),
    )
    .all();

  const connections = rows
    .map((r) => {
      const mine = managedParties.find((m) => m === r.orgAId || m === r.orgBId);
      if (!mine) return null;
      const cp = counterpartyOrgId(r as ConnectionRow, mine);
      return {
        connectionId: r.id,
        myOrgId: mine,
        counterpartyOrgId: cp,
        status: r.status,
        direction: r.status === "pending" ? (r.initiatedByOrgId === mine ? "outgoing" : "incoming") : null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ connections });
}

// POST /api/productions/[id]/connections — offer a visibility connection to a
// counterparty org on this production. Body { targetOrgId, tier }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { targetOrgId?: unknown; tier?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetOrgId = typeof body.targetOrgId === "string" ? body.targetOrgId : "";
  if (!targetOrgId) return NextResponse.json({ error: "targetOrgId is required" }, { status: 400 });
  const tier: VisibilityTier = isVisibilityTier(body.tier) ? body.tier : "identity";

  const db = getDb();
  const { parties, managedParties } = await callerParties(db, session.sub, id);
  if (managedParties.length === 0) {
    return NextResponse.json({ error: "You must manage an organisation attached to this production." }, { status: 403 });
  }
  if (!isPartyTo(parties, targetOrgId)) {
    return NextResponse.json({ error: "The target organisation is not attached to this production." }, { status: 400 });
  }

  // Pick the initiating org: a managed party that isn't the target (prefer the
  // producer org when the caller manages it).
  const candidates = managedParties.filter((o) => o !== targetOrgId);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "You cannot connect an organisation to itself." }, { status: 400 });
  }
  const initiatorOrgId = parties.producerOrgId && candidates.includes(parties.producerOrgId) ? parties.producerOrgId : candidates[0];

  const result = await offerConnection(db, {
    productionId: id,
    initiatorOrgId,
    targetOrgId,
    initiatedByUserId: session.sub,
    tier,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });

  // Best-effort notify the target org's owners/admins.
  void sendConnectionOfferNotification(db, { targetOrgId, initiatorOrgId, productionId: id });

  return NextResponse.json({ ok: true, connectionId: result.connectionId }, { status: 201 });
}
