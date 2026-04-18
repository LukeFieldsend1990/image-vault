export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users, talentReps, talentSettings, talentProfiles, productions, productionCompanies } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc, and, inArray, like } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceRequestedEmail, placeholderLicenceCreatedEmail } from "@/lib/email/templates";

type LicenceStatus =
  | "AWAITING_PACKAGE"
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "SCRUB_PERIOD"
  | "CLOSED"
  | "OVERDUE";

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
      packageScanType: scanPackages.scanType,
      packageTags: scanPackages.tags,
      packageHasMesh: scanPackages.hasMesh,
      packageHasTexture: scanPackages.hasTexture,
      packageHasHdr: scanPackages.hasHdr,
      packageHasMotionCapture: scanPackages.hasMotionCapture,
      talentEmail: users.email,
      talentName: talentProfiles.fullName,
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
      contractUrl: licences.contractUrl,
      contractUploadedAt: licences.contractUploadedAt,
    })
    .from(licences)
    .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .leftJoin(users, eq(users.id, licences.talentId))
    .leftJoin(talentSettings, eq(talentSettings.talentId, licences.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, licences.talentId));

  if (session.role === "talent") {
    const whereClause = statusFilter
      ? and(eq(licences.talentId, session.sub), eq(licences.status, statusFilter as LicenceStatus))
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
    // Optional talentId filter — scope to a single managed talent
    const forTalent = searchParams.get("talentId");
    const scopeIds = forTalent && talentIds.includes(forTalent) ? [forTalent] : talentIds;
    const whereClause = statusFilter
      ? and(inArray(licences.talentId, scopeIds), eq(licences.status, statusFilter as LicenceStatus))
      : inArray(licences.talentId, scopeIds);
    rows = await base.where(whereClause).orderBy(desc(licences.createdAt)).all();
  } else if (session.role === "licensee") {
    const whereClause = statusFilter
      ? and(eq(licences.licenseeId, session.sub), eq(licences.status, statusFilter as LicenceStatus))
      : eq(licences.licenseeId, session.sub);
    rows = await base.where(whereClause).orderBy(desc(licences.createdAt)).all();
  } else if (session.role === "admin") {
    rows = await base.orderBy(desc(licences.createdAt)).all();
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ licences: rows });
}

// POST /api/licences — submit a licence request (licensee) or create a
// placeholder licence with deal terms ahead of any scans (admin/talent/rep)
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    packageId?: string | null;
    talentId?: string;       // placeholder only — the talent the deal is for
    licenseeId?: string;     // placeholder only — the production company buyer
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
    agreedFee?: number;       // placeholder only — deal may already be signed
    productionId?: string;
    productionCompanyId?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId, projectName, productionCompany, intendedUse, validFrom, validTo } = body;
  if (!projectName || !productionCompany || !intendedUse || !validFrom || !validTo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const db = getDb();
  const isPlaceholder = !packageId;

  let resolvedTalentId: string;
  let resolvedLicenseeId: string;

  if (isPlaceholder) {
    // Placeholder: scans don't exist yet. Creator is admin/talent/rep on
    // behalf of a signed deal; licensee is specified explicitly.
    if (session.role !== "admin" && session.role !== "talent" && session.role !== "rep") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!body.talentId || !body.licenseeId) {
      return NextResponse.json(
        { error: "Placeholder licences require talentId and licenseeId" },
        { status: 400 }
      );
    }
    if (session.role === "talent" && body.talentId !== session.sub) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (session.role === "rep") {
      const [rep] = await db
        .select({ talentId: talentReps.talentId })
        .from(talentReps)
        .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, body.talentId)))
        .limit(1)
        .all();
      if (!rep) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    resolvedTalentId = body.talentId;
    resolvedLicenseeId = body.licenseeId;
  } else {
    // Standard licensee-initiated request against an existing package.
    if (session.role !== "licensee") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [pkg] = await db
      .select({ id: scanPackages.id, talentId: scanPackages.talentId, status: scanPackages.status })
      .from(scanPackages)
      .where(eq(scanPackages.id, packageId!))
      .limit(1)
      .all();

    if (!pkg || pkg.status !== "ready") {
      return NextResponse.json({ error: "Package not found or not available" }, { status: 404 });
    }

    const [talentUser] = await db
      .select({ vaultLocked: users.vaultLocked })
      .from(users)
      .where(eq(users.id, pkg.talentId))
      .limit(1)
      .all();

    if (talentUser?.vaultLocked) {
      return NextResponse.json({ error: "This vault is currently locked and not accepting licence requests" }, { status: 423 });
    }

    resolvedTalentId = pkg.talentId;
    resolvedLicenseeId = session.sub;
  }

  const now = Math.floor(Date.now() / 1000);
  const licenceId = crypto.randomUUID();

  // Resolve or create production company entity
  let resolvedCompanyId = body.productionCompanyId ?? null;
  if (!resolvedCompanyId && productionCompany) {
    const [existing] = await db
      .select({ id: productionCompanies.id })
      .from(productionCompanies)
      .where(like(productionCompanies.name, productionCompany.trim()))
      .limit(1)
      .all();
    if (existing) {
      resolvedCompanyId = existing.id;
    } else {
      resolvedCompanyId = crypto.randomUUID();
      await db.insert(productionCompanies).values({
        id: resolvedCompanyId,
        name: productionCompany.trim(),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // Resolve or create production entity
  let resolvedProductionId = body.productionId ?? null;
  if (!resolvedProductionId && projectName) {
    const [existing] = await db
      .select({ id: productions.id })
      .from(productions)
      .where(like(productions.name, projectName.trim()))
      .limit(1)
      .all();
    if (existing) {
      resolvedProductionId = existing.id;
    } else {
      resolvedProductionId = crypto.randomUUID();
      await db.insert(productions).values({
        id: resolvedProductionId,
        name: projectName.trim(),
        companyId: resolvedCompanyId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  await db.insert(licences).values({
    id: licenceId,
    talentId: resolvedTalentId,
    packageId: packageId ?? null,
    licenseeId: resolvedLicenseeId,
    projectName: projectName.trim(),
    productionCompany: productionCompany.trim(),
    intendedUse: intendedUse.trim(),
    validFrom,
    validTo,
    fileScope: body.fileScope ?? "all",
    status: isPlaceholder ? "AWAITING_PACKAGE" : "PENDING",
    licenceType: (body.licenceType as "film_double" | "game_character" | "commercial" | "ai_avatar" | "training_data" | "monitoring_reference" | undefined) ?? null,
    territory: body.territory ?? null,
    exclusivity: (body.exclusivity as "non_exclusive" | "sole" | "exclusive" | undefined) ?? "non_exclusive",
    permitAiTraining: body.permitAiTraining ?? false,
    proposedFee: body.proposedFee ?? null,
    agreedFee: isPlaceholder ? (body.agreedFee ?? null) : null,
    platformFee: isPlaceholder && body.agreedFee ? Math.round(body.agreedFee * 0.15) : null,
    productionId: resolvedProductionId,
    productionCompanyId: resolvedCompanyId,
    downloadCount: 0,
    createdAt: now,
  });

  // Notification routing depends on who created the licence.
  void (async () => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";

    if (isPlaceholder) {
      // Notify licensee: "Licence confirmed — awaiting scan capture"
      const [licenseeUser] = await Promise.all([
        db.select({ email: users.email }).from(users).where(eq(users.id, resolvedLicenseeId)).get(),
      ]);
      if (!licenseeUser?.email) return;
      const { subject, html } = placeholderLicenceCreatedEmail({
        licenseeEmail: licenseeUser.email,
        projectName: projectName.trim(),
        productionCompany: productionCompany.trim(),
        validFrom,
        validTo,
        viewUrl: `${baseUrl}/licences`,
      });
      await sendEmail({ to: licenseeUser.email, subject, html });
      return;
    }

    // Standard flow: notify talent of the new request
    const [pkg2, talentUser, licenseeUser] = await Promise.all([
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, packageId!)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, resolvedTalentId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, resolvedLicenseeId)).get(),
    ]);
    if (!talentUser?.email) return;
    const { subject, html } = licenceRequestedEmail({
      talentEmail: talentUser.email,
      licenseeEmail: licenseeUser?.email ?? "Unknown",
      projectName: projectName.trim(),
      productionCompany: productionCompany.trim(),
      intendedUse: intendedUse.trim(),
      packageName: pkg2?.name ?? packageId!,
      validFrom,
      validTo,
      reviewUrl: `${baseUrl}/vault/licences`,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ licenceId, status: isPlaceholder ? "AWAITING_PACKAGE" : "PENDING" }, { status: 201 });
}
