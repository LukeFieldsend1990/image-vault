export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

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
    })
    .from(licences)
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .leftJoin(users, eq(users.id, licences.talentId))
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = row.talentId === session.sub || row.licenseeId === session.sub;
  const isAdmin = ADMIN_EMAILS.includes(session.email);
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ licence: row });
}
