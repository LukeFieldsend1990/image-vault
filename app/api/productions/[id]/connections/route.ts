import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orgConnections, organisations } from "@/lib/db/schema";
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
import { isVendorOrgType } from "@/lib/organisations/orgTypes";
import { eq, or, inArray } from "drizzle-orm";
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

// GET /api/productions/[id]/connections — the caller's org-to-org connections,
// from the perspective of the org they manage on this production. Connections
// are org-level, so this returns every connection that org has (not just ones
// anchored to this production) — that's what lets a vendor connected elsewhere
// show as "Connected" here, and surface as a suggested vendor to attach.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { parties, managedParties } = await callerParties(db, session.sub, id);
  if (managedParties.length === 0) return NextResponse.json({ connections: [], suggestions: [] });

  // Perspective org: prefer the producer org when the caller manages it.
  const myOrg = parties.producerOrgId && managedParties.includes(parties.producerOrgId)
    ? parties.producerOrgId
    : managedParties[0];

  const rows = await db
    .select()
    .from(orgConnections)
    .where(or(eq(orgConnections.orgAId, myOrg), eq(orgConnections.orgBId, myOrg)))
    .all();

  const counterpartyIds = [...new Set(rows.map((r) => counterpartyOrgId(r as ConnectionRow, myOrg)).filter((v): v is string => Boolean(v)))];
  const orgRows = counterpartyIds.length
    ? await db
        .select({ id: organisations.id, name: organisations.name, orgType: organisations.orgType, shortCode: organisations.shortCode, vendorAuditPassed: organisations.vendorAuditPassed })
        .from(organisations)
        .where(inArray(organisations.id, counterpartyIds))
        .all()
    : [];
  const orgById = new Map(orgRows.map((o) => [o.id, o]));

  const connections = rows
    .filter((r) => r.status === "pending" || r.status === "active")
    .map((r) => {
      const cp = counterpartyOrgId(r as ConnectionRow, myOrg);
      return {
        connectionId: r.id,
        myOrgId: myOrg,
        counterpartyOrgId: cp,
        status: r.status,
        direction: r.status === "pending" ? (r.initiatedByOrgId === myOrg ? "outgoing" : "incoming") : null,
      };
    });

  // Connected vendor orgs → suggested when attaching vendors to this production.
  const suggestions = rows
    .filter((r) => r.status === "active")
    .map((r) => orgById.get(counterpartyOrgId(r as ConnectionRow, myOrg) ?? ""))
    .filter((o): o is NonNullable<typeof o> => Boolean(o) && isVendorOrgType(o!.orgType))
    .map((o) => ({ id: o.id, name: o.name, orgType: o.orgType, shortCode: o.shortCode, vendorAuditPassed: o.vendorAuditPassed }));

  return NextResponse.json({ connections, suggestions });
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
