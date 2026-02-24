export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc, or, and } from "drizzle-orm";

// GET /api/licences — list licences scoped to the caller's role
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  let rows;
  const base = db
    .select({
      id: licences.id,
      packageId: licences.packageId,
      packageName: scanPackages.name,
      talentEmail: users.email,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      fileScope: licences.fileScope,
      status: licences.status,
      approvedAt: licences.approvedAt,
      deniedAt: licences.deniedAt,
      deniedReason: licences.deniedReason,
      downloadCount: licences.downloadCount,
      lastDownloadAt: licences.lastDownloadAt,
      createdAt: licences.createdAt,
      licenseeId: licences.licenseeId,
      talentId: licences.talentId,
    })
    .from(licences)
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .leftJoin(users, eq(users.id, licences.talentId));

  if (session.role === "talent" || session.role === "rep") {
    const whereClause = statusFilter
      ? and(eq(licences.talentId, session.sub), eq(licences.status, statusFilter as "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"))
      : eq(licences.talentId, session.sub);
    rows = await base.where(whereClause).orderBy(desc(licences.createdAt)).all();
  } else if (session.role === "licensee") {
    const whereClause = statusFilter
      ? and(eq(licences.licenseeId, session.sub), eq(licences.status, statusFilter as "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"))
      : eq(licences.licenseeId, session.sub);
    rows = await base.where(whereClause).orderBy(desc(licences.createdAt)).all();
  } else if (session.role === "admin") {
    rows = await base.orderBy(desc(licences.createdAt)).all();
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ licences: rows });
}

// POST /api/licences — submit a licence request (licensee only)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "licensee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    packageId?: string;
    projectName?: string;
    productionCompany?: string;
    intendedUse?: string;
    validFrom?: number;
    validTo?: number;
    fileScope?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId, projectName, productionCompany, intendedUse, validFrom, validTo } = body;
  if (!packageId || !projectName || !productionCompany || !intendedUse || !validFrom || !validTo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const db = getDb();

  // Look up the package to get talent_id
  const [pkg] = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId, status: scanPackages.status })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .limit(1)
    .all();

  if (!pkg || pkg.status !== "ready") {
    return NextResponse.json({ error: "Package not found or not available" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  const licenceId = crypto.randomUUID();

  await db.insert(licences).values({
    id: licenceId,
    talentId: pkg.talentId,
    packageId,
    licenseeId: session.sub,
    projectName: projectName.trim(),
    productionCompany: productionCompany.trim(),
    intendedUse: intendedUse.trim(),
    validFrom,
    validTo,
    fileScope: body.fileScope ?? "all",
    status: "PENDING",
    downloadCount: 0,
    createdAt: now,
  });

  return NextResponse.json({ licenceId }, { status: 201 });
}
