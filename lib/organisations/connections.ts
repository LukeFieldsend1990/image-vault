// Organisation-to-organisation visibility consent — the consent engine behind
// specs/ORG-VISIBILITY-CONSENT-SPEC.md.
//
// Two orgs collaborating on a production can consent to see each other. The
// connection is MUTUAL (neither side sees the other until both accept) and
// production-scoped. Each side independently controls what it exposes about
// itself via a tier. This is an identity/contacts layer only — it is never a
// path to performer likeness data, which stays gated by vendorAuthorisations +
// Bridge. Every transition is mirrored into the compliance_events ledger.

import { and, eq, inArray, or } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  orgConnections,
  organisationMembers,
  organisations,
  productions,
  productionVendors,
  users,
} from "@/lib/db/schema";
import { appendEvent } from "@/lib/compliance/ledger";

type Db = ReturnType<typeof getDb>;

// ── Tiers (pure) ─────────────────────────────────────────────────────────────

export const VISIBILITY_TIERS = ["identity", "contacts", "shared_context"] as const;
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number];

export const TIER_LABELS: Record<VisibilityTier, string> = {
  identity: "Identity",
  contacts: "Identity + contacts",
  shared_context: "Identity + contacts + shared production",
};

export function isVisibilityTier(v: unknown): v is VisibilityTier {
  return typeof v === "string" && (VISIBILITY_TIERS as readonly string[]).includes(v);
}

export function tierRank(t: VisibilityTier): number {
  return VISIBILITY_TIERS.indexOf(t);
}

// Cumulative: contacts ⊇ identity, shared_context ⊇ contacts.
export function tierAtLeast(t: VisibilityTier, min: VisibilityTier): boolean {
  return tierRank(t) >= tierRank(min);
}

// ── Canonical pairing (pure) ─────────────────────────────────────────────────

export interface CanonicalPair {
  orgAId: string;
  orgBId: string;
}

// Store the two org ids in a stable order so (production, orgA, orgB) is unique
// regardless of who initiated. Lexical ordering — deterministic and DB-free.
export function canonicalPair(orgX: string, orgY: string): CanonicalPair {
  return orgX < orgY ? { orgAId: orgX, orgBId: orgY } : { orgAId: orgY, orgBId: orgX };
}

// ── Connection-row shape (subset we reason about) ────────────────────────────

export interface ConnectionRow {
  id: string;
  productionId: string;
  orgAId: string;
  orgBId: string;
  initiatedByOrgId: string;
  status: "pending" | "active" | "declined" | "revoked";
  orgATier: VisibilityTier;
  orgBTier: VisibilityTier;
}

// The other party's id from one side's perspective. null if `myOrgId` is not a
// party to the connection.
export function counterpartyOrgId(conn: ConnectionRow, myOrgId: string): string | null {
  if (conn.orgAId === myOrgId) return conn.orgBId;
  if (conn.orgBId === myOrgId) return conn.orgAId;
  return null;
}

// Which tier field belongs to `myOrgId` — the one I control about myself.
export function myTierFor(conn: ConnectionRow, myOrgId: string): VisibilityTier | null {
  if (conn.orgAId === myOrgId) return conn.orgATier;
  if (conn.orgBId === myOrgId) return conn.orgBTier;
  return null;
}

// The tier the COUNTERPARTY exposes to a viewer in `viewerOrgIds`. Visibility
// only exists while the connection is active — pending/declined/revoked → null.
export function exposedTierFor(conn: ConnectionRow, viewerOrgIds: string[]): VisibilityTier | null {
  if (conn.status !== "active") return null;
  if (viewerOrgIds.includes(conn.orgAId)) return conn.orgBTier; // viewer is A → B exposes orgBTier
  if (viewerOrgIds.includes(conn.orgBId)) return conn.orgATier; // viewer is B → A exposes orgATier
  return null;
}

// ── DB: production parties ───────────────────────────────────────────────────

export interface ProductionParties {
  producerOrgId: string | null;
  vendorOrgIds: string[];
}

// The orgs that are party to a production: the owning (producer) org plus every
// org attached as an active vendor. These are the only orgs that can form a
// connection on this production.
export async function getProductionParties(db: Db, productionId: string): Promise<ProductionParties> {
  const prod = await db
    .select({ organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, productionId))
    .get();

  const vendorRows = await db
    .select({ vendorOrgId: productionVendors.vendorOrgId })
    .from(productionVendors)
    .where(and(eq(productionVendors.productionId, productionId), eq(productionVendors.status, "active")))
    .all();

  const vendorOrgIds = [...new Set(vendorRows.map((r) => r.vendorOrgId).filter((v): v is string => Boolean(v)))];
  return { producerOrgId: prod?.organisationId ?? null, vendorOrgIds };
}

export function isPartyTo(parties: ProductionParties, orgId: string): boolean {
  return parties.producerOrgId === orgId || parties.vendorOrgIds.includes(orgId);
}

// Org ids the user can act for (owner/admin). Connections are a commercial/trust
// decision, so they require management rights — matching who can invite members.
export async function getManagedOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ organisationId: organisationMembers.organisationId, memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(eq(organisationMembers.userId, userId))
    .all();
  return rows.filter((r) => r.memberRole === "owner" || r.memberRole === "admin").map((r) => r.organisationId);
}

// ── DB: visibility resolver (the gatekeeper every cross-org read goes through) ─

export interface VisibilityResult {
  tier: VisibilityTier | null;
  connectionId: string | null;
}

// Resolve what `viewerOrgIds` may see of `targetOrgId`. Connections are
// org-to-org: a single active connection between the two orgs grants visibility
// across every production they both work on. Mirrors the shape of
// resolveOwnerAccess() in lib/productions/access.ts.
export async function resolveOrgVisibility(
  db: Db,
  viewerOrgIds: string[],
  targetOrgId: string,
): Promise<VisibilityResult> {
  if (viewerOrgIds.length === 0 || viewerOrgIds.includes(targetOrgId)) {
    return { tier: null, connectionId: null };
  }

  // The active connection: target is one party, a viewer org is the other.
  const conn = await db
    .select()
    .from(orgConnections)
    .where(
      and(
        eq(orgConnections.status, "active"),
        or(
          and(eq(orgConnections.orgAId, targetOrgId), inArray(orgConnections.orgBId, viewerOrgIds)),
          and(eq(orgConnections.orgBId, targetOrgId), inArray(orgConnections.orgAId, viewerOrgIds)),
        ),
      ),
    )
    .get();

  if (!conn) return { tier: null, connectionId: null };
  const tier = exposedTierFor(conn as ConnectionRow, viewerOrgIds);
  return tier ? { tier, connectionId: conn.id } : { tier: null, connectionId: null };
}

// ── DB: audit ────────────────────────────────────────────────────────────────

// One hash-chained ledger chain per connection — the provable history of the
// relationship. organisationId records the acting side.
async function recordConnectionEvent(
  db: Db,
  spec: { connectionId: string; eventType: string; actorId: string; orgId: string; payload?: unknown },
): Promise<void> {
  try {
    await appendEvent(db, {
      chainKey: `org-connection:${spec.connectionId}`,
      eventType: spec.eventType,
      organisationId: spec.orgId,
      actorId: spec.actorId,
      payload: spec.payload ?? {},
    });
  } catch {
    // Audit is best-effort — never block the consent action on a ledger write.
  }
}

// ── DB: lifecycle ops ────────────────────────────────────────────────────────

export interface OfferResult {
  ok: boolean;
  connectionId?: string;
  message?: string;
}

// Offer a connection from `initiatorOrgId` to `targetOrgId` on a production.
// Reuses an existing declined/revoked row (the unique pair index forbids a
// second). Caller must already be authorised to act for the initiator.
export async function offerConnection(
  db: Db,
  input: {
    productionId: string;
    initiatorOrgId: string;
    targetOrgId: string;
    initiatedByUserId: string;
    tier: VisibilityTier;
  },
): Promise<OfferResult> {
  if (input.initiatorOrgId === input.targetOrgId) {
    return { ok: false, message: "An organisation cannot connect to itself." };
  }
  const parties = await getProductionParties(db, input.productionId);
  if (!isPartyTo(parties, input.initiatorOrgId) || !isPartyTo(parties, input.targetOrgId)) {
    return { ok: false, message: "Both organisations must be attached to this production." };
  }

  const { orgAId, orgBId } = canonicalPair(input.initiatorOrgId, input.targetOrgId);
  const initiatorIsA = orgAId === input.initiatorOrgId;
  const now = Math.floor(Date.now() / 1000);

  // One connection per org pair (regardless of which production it was first
  // offered on) — an active connection spans every shared production.
  const existing = await db
    .select()
    .from(orgConnections)
    .where(and(eq(orgConnections.orgAId, orgAId), eq(orgConnections.orgBId, orgBId)))
    .get();

  if (existing && (existing.status === "active" || existing.status === "pending")) {
    return { ok: false, message: existing.status === "active" ? "Already connected." : "A request is already pending." };
  }

  if (existing) {
    // Re-offer over a declined/revoked row — reset cleanly to pending, re-anchored
    // to the production this fresh offer was made from.
    await db
      .update(orgConnections)
      .set({
        productionId: input.productionId,
        initiatedByOrgId: input.initiatorOrgId,
        initiatedByUserId: input.initiatedByUserId,
        status: "pending",
        orgATier: initiatorIsA ? input.tier : "identity",
        orgBTier: initiatorIsA ? "identity" : input.tier,
        respondedByUserId: null,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        revokedByOrgId: null,
        updatedAt: now,
      })
      .where(eq(orgConnections.id, existing.id));
    await recordConnectionEvent(db, { connectionId: existing.id, eventType: "org_connection.offered", actorId: input.initiatedByUserId, orgId: input.initiatorOrgId, payload: { tier: input.tier, reoffer: true } });
    return { ok: true, connectionId: existing.id };
  }

  const id = crypto.randomUUID();
  await db.insert(orgConnections).values({
    id,
    productionId: input.productionId,
    orgAId,
    orgBId,
    initiatedByOrgId: input.initiatorOrgId,
    initiatedByUserId: input.initiatedByUserId,
    status: "pending",
    orgATier: initiatorIsA ? input.tier : "identity",
    orgBTier: initiatorIsA ? "identity" : input.tier,
    createdAt: now,
    updatedAt: now,
  });
  await recordConnectionEvent(db, { connectionId: id, eventType: "org_connection.offered", actorId: input.initiatedByUserId, orgId: input.initiatorOrgId, payload: { tier: input.tier } });
  return { ok: true, connectionId: id };
}

export interface RespondResult {
  ok: boolean;
  message?: string;
}

// Responder org (the non-initiator party) accepts or declines a pending offer.
export async function respondConnection(
  db: Db,
  input: { connectionId: string; responderOrgId: string; userId: string; action: "accept" | "decline"; tier: VisibilityTier },
): Promise<RespondResult> {
  const conn = await db.select().from(orgConnections).where(eq(orgConnections.id, input.connectionId)).get();
  if (!conn) return { ok: false, message: "Connection not found." };
  if (conn.status !== "pending") return { ok: false, message: "This request is no longer pending." };

  const other = counterpartyOrgId(conn as ConnectionRow, conn.initiatedByOrgId);
  if (other !== input.responderOrgId) {
    return { ok: false, message: "Only the invited organisation can respond." };
  }
  const responderIsA = conn.orgAId === input.responderOrgId;
  const now = Math.floor(Date.now() / 1000);

  if (input.action === "decline") {
    await db.update(orgConnections).set({ status: "declined", declinedAt: now, respondedByUserId: input.userId, updatedAt: now }).where(eq(orgConnections.id, conn.id));
    await recordConnectionEvent(db, { connectionId: conn.id, eventType: "org_connection.declined", actorId: input.userId, orgId: input.responderOrgId });
    return { ok: true };
  }

  await db
    .update(orgConnections)
    .set({
      status: "active",
      acceptedAt: now,
      respondedByUserId: input.userId,
      orgATier: responderIsA ? input.tier : conn.orgATier,
      orgBTier: responderIsA ? conn.orgBTier : input.tier,
      updatedAt: now,
    })
    .where(eq(orgConnections.id, conn.id));
  await recordConnectionEvent(db, { connectionId: conn.id, eventType: "org_connection.accepted", actorId: input.userId, orgId: input.responderOrgId, payload: { tier: input.tier } });
  return { ok: true };
}

// Change the tier `orgId` exposes about itself. Either party, any time.
export async function setOwnTier(
  db: Db,
  input: { connectionId: string; orgId: string; tier: VisibilityTier },
): Promise<RespondResult> {
  const conn = await db.select().from(orgConnections).where(eq(orgConnections.id, input.connectionId)).get();
  if (!conn) return { ok: false, message: "Connection not found." };
  const field = myTierFor(conn as ConnectionRow, input.orgId);
  if (field === null) return { ok: false, message: "Not a party to this connection." };
  const now = Math.floor(Date.now() / 1000);
  const isA = conn.orgAId === input.orgId;
  await db
    .update(orgConnections)
    .set({ ...(isA ? { orgATier: input.tier } : { orgBTier: input.tier }), updatedAt: now })
    .where(eq(orgConnections.id, conn.id));
  return { ok: true };
}

// Sever a connection. Either party's owner/admin. Visibility ends immediately.
export async function revokeConnection(
  db: Db,
  input: { connectionId: string; orgId: string; userId: string },
): Promise<RespondResult> {
  const conn = await db.select().from(orgConnections).where(eq(orgConnections.id, input.connectionId)).get();
  if (!conn) return { ok: false, message: "Connection not found." };
  if (counterpartyOrgId(conn as ConnectionRow, input.orgId) === null) {
    return { ok: false, message: "Not a party to this connection." };
  }
  if (conn.status === "revoked") return { ok: true };
  const now = Math.floor(Date.now() / 1000);
  await db.update(orgConnections).set({ status: "revoked", revokedAt: now, revokedByOrgId: input.orgId, updatedAt: now }).where(eq(orgConnections.id, conn.id));
  await recordConnectionEvent(db, { connectionId: conn.id, eventType: "org_connection.revoked", actorId: input.userId, orgId: input.orgId });
  return { ok: true };
}

// ── DB: list + render (org view) ─────────────────────────────────────────────

export interface CounterpartyContact {
  email: string;
  memberRole: string;
}

export interface ConnectionView {
  connectionId: string;
  productionId: string;
  productionName: string | null;
  status: "pending" | "active" | "declined" | "revoked";
  direction: "incoming" | "outgoing" | null; // for pending requests
  myTier: VisibilityTier;
  theirExposedTier: VisibilityTier | null; // only when active
  counterparty: {
    orgId: string;
    name: string;
    orgType: string | null;
    shortCode: string | null;
    // identity tier
    country: string | null;
    vendorAuditPassed: boolean | null;
    // contacts tier (only populated when theirExposedTier ⊇ contacts)
    contacts: CounterpartyContact[] | null;
  };
}

// Every connection `orgId` is a party to, rendered from that org's perspective
// with least-privilege visibility applied (contacts only surface when the
// counterparty has exposed them and the connection is active).
export async function listOrgConnections(db: Db, orgId: string): Promise<ConnectionView[]> {
  const rows = await db
    .select()
    .from(orgConnections)
    .where(or(eq(orgConnections.orgAId, orgId), eq(orgConnections.orgBId, orgId)))
    .all();

  const visible = rows.filter((r) => r.status === "pending" || r.status === "active");
  if (visible.length === 0) return [];

  const counterpartyIds = [...new Set(visible.map((r) => counterpartyOrgId(r as ConnectionRow, orgId)).filter((v): v is string => Boolean(v)))];
  const prodIds = [...new Set(visible.map((r) => r.productionId))];

  const orgRows = counterpartyIds.length
    ? await db.select({ id: organisations.id, name: organisations.name, orgType: organisations.orgType, shortCode: organisations.shortCode, country: organisations.country, vendorAuditPassed: organisations.vendorAuditPassed }).from(organisations).where(inArray(organisations.id, counterpartyIds)).all()
    : [];
  const orgById = new Map(orgRows.map((o) => [o.id, o]));

  const prodRows = prodIds.length
    ? await db.select({ id: productions.id, name: productions.name }).from(productions).where(inArray(productions.id, prodIds)).all()
    : [];
  const prodById = new Map(prodRows.map((p) => [p.id, p.name]));

  // Which counterparties have exposed contacts to us → batch-fetch owner/admins.
  const contactsByOrg = new Map<string, CounterpartyContact[]>();
  const needContacts = visible
    .filter((r) => {
      const tier = exposedTierFor(r as ConnectionRow, [orgId]);
      return tier !== null && tierAtLeast(tier, "contacts");
    })
    .map((r) => counterpartyOrgId(r as ConnectionRow, orgId))
    .filter((v): v is string => Boolean(v));
  const uniqueNeedContacts = [...new Set(needContacts)];
  if (uniqueNeedContacts.length) {
    const memberRows = await db
      .select({ organisationId: organisationMembers.organisationId, email: users.email, memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(and(inArray(organisationMembers.organisationId, uniqueNeedContacts), inArray(organisationMembers.memberRole, ["owner", "admin"])))
      .all();
    for (const m of memberRows) {
      const list = contactsByOrg.get(m.organisationId) ?? [];
      list.push({ email: m.email, memberRole: m.memberRole });
      contactsByOrg.set(m.organisationId, list);
    }
  }

  return visible.map((r) => {
    const cpId = counterpartyOrgId(r as ConnectionRow, orgId)!;
    const cp = orgById.get(cpId);
    const theirExposedTier = exposedTierFor(r as ConnectionRow, [orgId]);
    const showContacts = theirExposedTier !== null && tierAtLeast(theirExposedTier, "contacts");
    const direction: ConnectionView["direction"] =
      r.status === "pending" ? (r.initiatedByOrgId === orgId ? "outgoing" : "incoming") : null;
    return {
      connectionId: r.id,
      productionId: r.productionId,
      productionName: prodById.get(r.productionId) ?? null,
      status: r.status,
      direction,
      myTier: (myTierFor(r as ConnectionRow, orgId) ?? "identity") as VisibilityTier,
      theirExposedTier,
      counterparty: {
        orgId: cpId,
        name: cp?.name ?? "Unknown organisation",
        orgType: cp?.orgType ?? null,
        shortCode: cp?.shortCode ?? null,
        // Identity is revealed once active; while pending we still show name/type
        // (the vendor-attach anchor already implies it) but withhold jurisdiction
        // and audit posture until both sides have consented.
        country: r.status === "active" ? cp?.country ?? null : null,
        vendorAuditPassed: r.status === "active" ? cp?.vendorAuditPassed ?? null : null,
        contacts: showContacts ? contactsByOrg.get(cpId) ?? [] : null,
      },
    };
  });
}
