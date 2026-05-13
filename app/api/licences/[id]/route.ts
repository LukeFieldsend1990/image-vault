export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users, productions, organisationMembers } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

// GET /api/licences/[id] — fetch a single licence (talent, licensee, admin)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const row = await db
    .select({
      id: licences.id,
      packageId: licences.packageId,
      packageName: scanPackages.name,
      talentId: licences.talentId,
      talentEmail: users.email,
      licenseeId: licences.licenseeId,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      fileScope: licences.fileScope,
      status: licences.status,
      licenceType: licences.licenceType,
      territory: licences.territory,
      exclusivity: licences.exclusivity,
      permitAiTraining: licences.permitAiTraining,
      proposedFee: licences.proposedFee,
      agreedFee: licences.agreedFee,
      platformFee: licences.platformFee,
      approvedAt: licences.approvedAt,
      deniedAt: licences.deniedAt,
      deniedReason: licences.deniedReason,
      downloadCount: licences.downloadCount,
      lastDownloadAt: licences.lastDownloadAt,
      createdAt: licences.createdAt,
      preauthUntil: licences.preauthUntil,
      preauthSetBy: licences.preauthSetBy,
    })
    .from(licences)
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .leftJoin(users, eq(users.id, licences.talentId))
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = row.talentId === session.sub || row.licenseeId === session.sub;
  const admin = isAdmin(session.email);
  if (!isOwner && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ licence: row });
}

// PATCH /api/licences/[id] — update delivery mode (talent or admin), or productionId/organisationId (licensee or admin)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const row = await db
    .select({ talentId: licences.talentId, licenseeId: licences.licenseeId, status: licences.status })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = isAdmin(session.email);
  const isTalentOwner = row.talentId === session.sub;
  const isLicenseeOwner = row.licenseeId === session.sub;

  if (!isTalentOwner && !isLicenseeOwner && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { deliveryMode?: string; productionId?: string; organisationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Talent/admin: update delivery mode
  if ("deliveryMode" in body) {
    if (!isTalentOwner && !admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { deliveryMode } = body;
    if (deliveryMode !== "standard" && deliveryMode !== "bridge_only") {
      return NextResponse.json({ error: "deliveryMode must be 'standard' or 'bridge_only'" }, { status: 400 });
    }
    await db.update(licences).set({ deliveryMode }).where(eq(licences.id, id));
    return NextResponse.json({ ok: true });
  }

  // Licensee/admin: link production and/or organisation
  if ("productionId" in body || "organisationId" in body) {
    if (!isLicenseeOwner && !admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Partial<{ productionId: string; organisationId: string }> = {};

    if (body.productionId) {
      const prod = await db
        .select({ id: productions.id })
        .from(productions)
        .where(eq(productions.id, body.productionId))
        .get();
      if (!prod) return NextResponse.json({ error: "Production not found" }, { status: 404 });
      updates.productionId = body.productionId;
    }

    if (body.organisationId) {
      // Verify the licensee is a member of this organisation
      if (!admin) {
        const membership = await db
          .select({ organisationId: organisationMembers.organisationId })
          .from(organisationMembers)
          .where(and(
            eq(organisationMembers.userId, session.sub),
            eq(organisationMembers.organisationId, body.organisationId),
          ))
          .get();
        if (!membership) return NextResponse.json({ error: "Not a member of that organisation" }, { status: 403 });
      }
      updates.organisationId = body.organisationId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await db.update(licences).set(updates).where(eq(licences.id, id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
