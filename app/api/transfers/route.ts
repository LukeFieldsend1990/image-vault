export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  scanTransfers,
  scanPackages,
  organisations,
  organisationMembers,
  licences,
  users,
  talentReps,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { mintScanNumber } from "@/lib/codes/codes";
import { eq, and, inArray, desc } from "drizzle-orm";

// GET /api/transfers — incoming (as talent/rep) + outgoing (as org member) transfers
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Orgs the caller belongs to → outgoing transfers
  const memberships = await db
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .where(eq(organisationMembers.userId, session.sub))
    .all();
  const orgIds = memberships.map((m) => m.organisationId);

  // Talent ids whose incoming transfers the caller can see (self + managed talent for reps)
  const talentIds = new Set<string>([session.sub]);
  if (session.role === "rep") {
    const managed = await db
      .select({ talentId: talentReps.talentId })
      .from(talentReps)
      .where(eq(talentReps.repId, session.sub))
      .all();
    managed.forEach((m) => talentIds.add(m.talentId));
  }

  const selectCols = {
    id: scanTransfers.id,
    transferType: scanTransfers.transferType,
    status: scanTransfers.status,
    lookLabel: scanTransfers.lookLabel,
    fromOrgId: scanTransfers.fromOrgId,
    orgName: organisations.name,
    orgType: organisations.orgType,
    orgShortCode: organisations.shortCode,
    toTalentId: scanTransfers.toTalentId,
    targetLicenceId: scanTransfers.targetLicenceId,
    packageId: scanTransfers.packageId,
    packageName: scanPackages.name,
    packageScanNumber: scanPackages.scanNumber,
    packageStatus: scanPackages.status,
    packageSizeBytes: scanPackages.totalSizeBytes,
    createdAt: scanTransfers.createdAt,
    submittedAt: scanTransfers.submittedAt,
    decidedAt: scanTransfers.decidedAt,
  };

  const [outgoing, incoming] = await Promise.all([
    orgIds.length
      ? db
          .select(selectCols)
          .from(scanTransfers)
          .innerJoin(organisations, eq(organisations.id, scanTransfers.fromOrgId))
          .innerJoin(scanPackages, eq(scanPackages.id, scanTransfers.packageId))
          .where(inArray(scanTransfers.fromOrgId, orgIds))
          .orderBy(desc(scanTransfers.createdAt))
          .all()
      : Promise.resolve([]),
    db
      .select(selectCols)
      .from(scanTransfers)
      .innerJoin(organisations, eq(organisations.id, scanTransfers.fromOrgId))
      .innerJoin(scanPackages, eq(scanPackages.id, scanTransfers.packageId))
      .where(inArray(scanTransfers.toTalentId, Array.from(talentIds)))
      .orderBy(desc(scanTransfers.createdAt))
      .all(),
  ]);

  return NextResponse.json({ incoming, outgoing });
}

// POST /api/transfers — an org member stages a new scan delivery (capture upload-on-behalf)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    fromOrgId?: string;
    transferType?: string;
    toTalentEmail?: string;
    toTalentId?: string;
    targetLicenceId?: string;
    lookLabel?: string;
    captureDate?: number;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { fromOrgId, transferType } = body;
  if (!fromOrgId) return NextResponse.json({ error: "fromOrgId is required" }, { status: 400 });
  if (transferType !== "to_talent" && transferType !== "to_licence") {
    return NextResponse.json({ error: "transferType must be to_talent or to_licence" }, { status: 400 });
  }
  if (!body.lookLabel?.trim()) {
    return NextResponse.json({ error: "lookLabel is required" }, { status: 400 });
  }

  const db = getDb();

  // Caller must be a member of the sending org
  const membership = await db
    .select({ memberRole: organisationMembers.memberRole })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, fromOrgId), eq(organisationMembers.userId, session.sub)))
    .get();
  if (!membership && session.role !== "admin") {
    return NextResponse.json({ error: "Not a member of this organisation" }, { status: 403 });
  }

  // Resolve the target talent + (optionally) the licence
  let toTalentId: string;
  let targetLicenceId: string | null = null;

  if (transferType === "to_licence") {
    if (!body.targetLicenceId) {
      return NextResponse.json({ error: "targetLicenceId is required for to_licence" }, { status: 400 });
    }
    const licence = await db
      .select({ id: licences.id, talentId: licences.talentId, status: licences.status })
      .from(licences)
      .where(eq(licences.id, body.targetLicenceId))
      .get();
    if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
    if (licence.status !== "AWAITING_PACKAGE") {
      return NextResponse.json({ error: "Licence is not awaiting a package" }, { status: 409 });
    }
    toTalentId = licence.talentId;
    targetLicenceId = licence.id;
  } else {
    // to_talent — resolve by id or email
    let target = body.toTalentId
      ? await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, body.toTalentId)).get()
      : undefined;
    if (!target && body.toTalentEmail) {
      target = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, body.toTalentEmail.trim().toLowerCase()))
        .get();
    }
    if (!target) return NextResponse.json({ error: "Target talent not found" }, { status: 404 });
    if (target.role !== "talent") {
      return NextResponse.json({ error: "Target must be a talent account" }, { status: 400 });
    }
    toTalentId = target.id;
  }

  const now = Math.floor(Date.now() / 1000);
  const packageId = crypto.randomUUID();
  const transferId = crypto.randomUUID();

  // Staged package is owned by the uploading org member until accepted. This lets
  // the existing (owner-gated) upload endpoints work with no auth changes.
  await db.insert(scanPackages).values({
    id: packageId,
    talentId: session.sub,
    name: body.lookLabel.trim(),
    captureDate: body.captureDate ?? null,
    studioName: null,
    status: "uploading",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(scanTransfers).values({
    id: transferId,
    fromOrgId,
    transferType,
    toTalentId,
    targetLicenceId,
    packageId,
    lookLabel: body.lookLabel.trim(),
    status: "pending",
    createdBy: session.sub,
    createdAt: now,
  });

  // Scan number tracks the eventual target talent's sequence, not the staging owner.
  await mintScanNumber(db, packageId, toTalentId);

  return NextResponse.json({ transferId, packageId }, { status: 201 });
}
