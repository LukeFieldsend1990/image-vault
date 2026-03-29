export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users, talentReps, talentSettings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc, and, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceRequestedEmail } from "@/lib/email/templates";

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
      licenceType: licences.licenceType,
      territory: licences.territory,
      exclusivity: licences.exclusivity,
      permitAiTraining: licences.permitAiTraining,
      proposedFee: licences.proposedFee,
      agreedFee: licences.agreedFee,
      platformFee: licences.platformFee,
      agencySharePct: talentSettings.agencySharePct,
      talentSharePct: talentSettings.talentSharePct,
      deliveryMode: licences.deliveryMode,
      preauthUntil: licences.preauthUntil,
      preauthSetBy: licences.preauthSetBy,
    })
    .from(licences)
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .leftJoin(users, eq(users.id, licences.talentId))
    .leftJoin(talentSettings, eq(talentSettings.talentId, licences.talentId));

  if (session.role === "talent") {
    const whereClause = statusFilter
      ? and(eq(licences.talentId, session.sub), eq(licences.status, statusFilter as "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"))
      : eq(licences.talentId, session.sub);
    rows = await base.where(whereClause).orderBy(desc(licences.createdAt)).all();
  } else if (session.role === "rep") {
    const talentRows = await db
      .select({ talentId: talentReps.talentId })
      .from(talentReps)
      .where(eq(talentReps.repId, session.sub))
      .all();
    const talentIds = talentRows.map((r) => r.talentId);
    if (talentIds.length === 0) return NextResponse.json({ licences: [] });
    const whereClause = statusFilter
      ? and(inArray(licences.talentId, talentIds), eq(licences.status, statusFilter as "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"))
      : inArray(licences.talentId, talentIds);
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
    licenceType?: string;
    territory?: string;
    exclusivity?: string;
    permitAiTraining?: boolean;
    proposedFee?: number;
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

  // Reject if talent has vault locked
  const [talentUser] = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, pkg.talentId))
    .limit(1)
    .all();

  if (talentUser?.vaultLocked) {
    return NextResponse.json({ error: "This vault is currently locked and not accepting licence requests" }, { status: 423 });
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
    licenceType: (body.licenceType as "film_double" | "game_character" | "commercial" | "ai_avatar" | "training_data" | "monitoring_reference" | undefined) ?? null,
    territory: body.territory ?? null,
    exclusivity: (body.exclusivity as "non_exclusive" | "sole" | "exclusive" | undefined) ?? "non_exclusive",
    permitAiTraining: body.permitAiTraining ?? false,
    proposedFee: body.proposedFee ?? null,
    downloadCount: 0,
    createdAt: now,
  });

  // Notify talent of new request (fire-and-forget)
  void (async () => {
    const [pkg2, talentUser, licenseeUser] = await Promise.all([
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, packageId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, pkg.talentId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get(),
    ]);
    if (!talentUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = licenceRequestedEmail({
      talentEmail: talentUser.email,
      licenseeEmail: licenseeUser?.email ?? "Unknown",
      projectName: projectName.trim(),
      productionCompany: productionCompany.trim(),
      intendedUse: intendedUse.trim(),
      packageName: pkg2?.name ?? packageId,
      validFrom,
      validTo,
      reviewUrl: `${baseUrl}/vault/licences`,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ licenceId }, { status: 201 });
}
