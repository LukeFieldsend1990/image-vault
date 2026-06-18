export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, users, organisationMembers } from "@/lib/db/schema";
// deliveryMode is read below to block standard download for bridge_only licences
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isIndustryRole } from "@/lib/auth/roles";
import { eq, and } from "drizzle-orm";
import { notifyTalentAndReps } from "@/lib/notifications/create";

export interface DualCustodySession {
  licenceId: string;
  licenseeId: string;          // user who initiated
  completedByLicenseeId?: string; // org member who completed the licensee 2FA (may differ from initiator)
  organisationId: string | null;
  talentId: string;
  packageId: string;
  step: "awaiting_licensee" | "awaiting_talent" | "complete";
  downloadTokens: Array<{ fileId: string; filename: string; token: string }>;
  initiatedAt: number;
  expiresAt: number;
}

// POST /api/licences/[id]/download/initiate — licensee starts the dual-custody download flow
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (!isIndustryRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const kv = getKv();

  const [licence] = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      packageId: licences.packageId,
      licenseeId: licences.licenseeId,
      organisationId: licences.organisationId,
      status: licences.status,
      validTo: licences.validTo,
      deliveryMode: licences.deliveryMode,
      projectName: licences.projectName,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Allow the named licensee OR any member of the org the licence belongs to
  if (licence.licenseeId !== session.sub) {
    let authorised = false;
    if (licence.organisationId) {
      const db = getDb();
      const [membership] = await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, licence.organisationId),
          eq(organisationMembers.userId, session.sub)
        ))
        .limit(1)
        .all();
      authorised = !!membership;
    }
    if (!authorised) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Licence is not approved" }, { status: 409 });
  }
  if (!licence.packageId) {
    return NextResponse.json({ error: "Licence has no package attached" }, { status: 409 });
  }

  const now = Math.floor(Date.now() / 1000);
  // validTo is stored as midnight of the expiry date — licence is valid through end of that day
  if (licence.validTo + 86400 <= now) {
    return NextResponse.json({ error: "Licence has expired" }, { status: 409 });
  }

  // Block if talent has vault locked
  const [talentUser] = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, licence.talentId))
    .limit(1)
    .all();

  if (talentUser?.vaultLocked) {
    return NextResponse.json({ error: "This vault is currently locked" }, { status: 423 });
  }

  // Block standard download for bridge-only licences
  if (licence.deliveryMode === "bridge_only") {
    return NextResponse.json(
      { error: "This licence requires the CAS Bridge desktop app for file access." },
      { status: 403 }
    );
  }

  // Check if there's already an active session
  const existing = await kv.get(`dual_custody:${id}`, "json") as DualCustodySession | null;
  if (existing && existing.step !== "complete" && existing.expiresAt > now) {
    return NextResponse.json({ step: existing.step });
  }

  const session_data: DualCustodySession = {
    licenceId: id,
    licenseeId: session.sub,
    organisationId: licence.organisationId ?? null,
    talentId: licence.talentId,
    packageId: licence.packageId,
    step: "awaiting_licensee",
    downloadTokens: [],
    initiatedAt: now,
    expiresAt: now + 3600, // 1 hour window
  };

  await kv.put(`dual_custody:${id}`, JSON.stringify(session_data), {
    expirationTtl: 3600,
  });

  void notifyTalentAndReps(db, licence.talentId, {
    type: "download_initiated",
    title: "Download approval needed",
    body: licence.projectName,
    href: `/vault/licences`,
  });

  return NextResponse.json({ step: "awaiting_licensee" });
}
