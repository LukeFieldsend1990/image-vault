export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, users } from "@/lib/db/schema";
// deliveryMode is read below to block standard download for bridge_only licences
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

export interface DualCustodySession {
  licenceId: string;
  licenseeId: string;
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

  if (session.role !== "licensee") {
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
      status: licences.status,
      validTo: licences.validTo,
      deliveryMode: licences.deliveryMode,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (licence.licenseeId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Licence is not approved" }, { status: 409 });
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

  return NextResponse.json({ step: "awaiting_licensee" });
}
