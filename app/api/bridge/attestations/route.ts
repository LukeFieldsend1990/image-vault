import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  bridgeAttestations,
  bridgeEvents,
  organisationMembers,
  organisations,
  productionVendors,
  productions,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { createNotification } from "@/lib/notifications/create";
import { STATEMENT_VERSIONS, type BridgeAttestationKind } from "@/lib/bridge/setup";

const VALID_KINDS: BridgeAttestationKind[] = ["local_access", "bridge_live"];

/**
 * POST /api/bridge/attestations
 *
 * Records an audit-logged human sign-off during guided Bridge setup.
 *   - local_access: vendor confirms their proxy folder is secured to the rules.
 *   - bridge_live:  final go-live; flips the org to Ready and notifies the
 *                   productions that invited it.
 *
 * Body: { organisationId, kind }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isIndustryRole(session.role) && session.role !== "admin") {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  let body: { organisationId?: string; kind?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { organisationId } = body;
  const kind = body.kind as BridgeAttestationKind | undefined;
  if (!organisationId) {
    return NextResponse.json({ error: "organisationId is required" }, { status: 400 });
  }
  if (!kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind must be local_access or bridge_live" }, { status: 400 });
  }

  const db = getDb();

  // Caller must be a member of the org (admins bypass the membership check).
  if (session.role !== "admin") {
    const membership = await db
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, organisationId),
          eq(organisationMembers.userId, session.sub),
        ),
      )
      .get();
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organisation" }, { status: 403 });
    }
  }

  const org = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .get();
  if (!org) {
    return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);

  await db.insert(bridgeAttestations).values({
    id: crypto.randomUUID(),
    organisationId,
    attestedByUserId: session.sub,
    kind,
    statementVersion: STATEMENT_VERSIONS[kind],
    attestedAt: now,
  });

  // Audit trail alongside the rest of the bridge lifecycle events.
  await db.insert(bridgeEvents).values({
    id: crypto.randomUUID(),
    grantId: null,
    packageId: "_attestation_",
    deviceId: organisationId,
    userId: session.sub,
    eventType: kind === "local_access" ? "local_access_attested" : "bridge_live_attested",
    severity: "info",
    detail: JSON.stringify({ organisationId, statementVersion: STATEMENT_VERSIONS[kind] }),
    createdAt: now,
  });

  // On go-live, notify the coordinators of every production that invited this org.
  if (kind === "bridge_live") {
    void (async () => {
      try {
        const rows = await db
          .select({
            productionId: productionVendors.productionId,
            productionName: productions.name,
            coordinatorId: productions.coordinatorId,
          })
          .from(productionVendors)
          .leftJoin(productions, eq(productions.id, productionVendors.productionId))
          .where(
            and(
              eq(productionVendors.vendorOrgId, organisationId),
              eq(productionVendors.status, "active"),
              isNull(productionVendors.revokedAt),
            ),
          )
          .all();

        const seen = new Set<string>();
        for (const r of rows) {
          if (!r.coordinatorId || seen.has(r.coordinatorId)) continue;
          seen.add(r.coordinatorId);
          await createNotification(db, {
            userId: r.coordinatorId,
            type: "bridge_live",
            title: `${org.name} is ready on the Bridge`,
            body: `${org.name} has completed Bridge setup${r.productionName ? ` for ${r.productionName}` : ""} and can now receive authorised work.`,
            href: `/productions/${r.productionId}`,
          });
        }
      } catch {
        // best-effort — never block the attestation on a notification failure
      }
    })();
  }

  return NextResponse.json({ ok: true, kind, attestedAt: now }, { status: 201 });
}
