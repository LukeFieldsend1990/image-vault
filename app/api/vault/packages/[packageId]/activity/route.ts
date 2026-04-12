export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, licences, downloadEvents, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, inArray } from "drizzle-orm";

export type CustodyEventType =
  | "package_created"
  | "file_added"
  | "licence_requested"
  | "licence_approved"
  | "licence_denied"
  | "licence_revoked"
  | "file_downloaded"
  | "talent_downloaded";

export interface CustodyEvent {
  type: CustodyEventType;
  at: number; // unix timestamp
  // package_created
  actor?: string;
  // file_added
  filename?: string;
  sizeBytes?: number;
  // licence events
  licenceId?: string;
  projectName?: string;
  productionCompany?: string;
  licensee?: string;
  intendedUse?: string;
  validFrom?: number;
  validTo?: number;
  approvedBy?: string;
  deniedReason?: string | null;
  // file_downloaded
  bytesTransferred?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  completedAt?: number | null;
}

export interface CustodyPackage {
  id: string;
  name: string;
  captureDate: number | null;
  studioName: string | null;
  talentEmail: string;
  createdAt: number;
}

export interface ActivityResponse {
  package: CustodyPackage;
  events: CustodyEvent[];
  generatedAt: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      name: scanPackages.name,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      createdAt: scanPackages.createdAt,
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  const admin = isAdmin(session.email);

  if (!isOwner && !isRep && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch all raw data ──────────────────────────────────────────────────────

  const [talentUser, files, licenceRows] = await Promise.all([
    db.select({ email: users.email }).from(users).where(eq(users.id, pkg.talentId)).get(),
    db.select({
      id: scanFiles.id,
      packageId: scanFiles.packageId,
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      createdAt: scanFiles.createdAt,
    }).from(scanFiles).where(eq(scanFiles.packageId, packageId)).all(),
    db.select({
      id: licences.id,
      licenseeId: licences.licenseeId,
      approvedBy: licences.approvedBy,
      createdAt: licences.createdAt,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      intendedUse: licences.intendedUse,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      approvedAt: licences.approvedAt,
      deniedAt: licences.deniedAt,
      deniedReason: licences.deniedReason,
      revokedAt: licences.revokedAt,
    }).from(licences).where(eq(licences.packageId, packageId)).all(),
  ]);

  // Collect all user IDs we need emails for
  const userIdSet = new Set<string>();
  for (const l of licenceRows) {
    userIdSet.add(l.licenseeId);
    if (l.approvedBy) userIdSet.add(l.approvedBy);
  }

  let dlEvents: {
    fileId: string;
    licenseeId: string;
    licenceId: string | null;
    startedAt: number;
    bytesTransferred: number | null;
    ip: string | null;
    userAgent: string | null;
    completedAt: number | null;
  }[] = [];
  const fileIds = files.map((f) => f.id);
  if (fileIds.length > 0) {
    dlEvents = await db
      .select({
        fileId: downloadEvents.fileId,
        licenseeId: downloadEvents.licenseeId,
        licenceId: downloadEvents.licenceId,
        startedAt: downloadEvents.startedAt,
        bytesTransferred: downloadEvents.bytesTransferred,
        ip: downloadEvents.ip,
        userAgent: downloadEvents.userAgent,
        completedAt: downloadEvents.completedAt,
      })
      .from(downloadEvents)
      .where(inArray(downloadEvents.fileId, fileIds))
      .all();
    for (const dl of dlEvents) userIdSet.add(dl.licenseeId);
  }

  // Fetch all user emails in one query
  const userMap = new Map<string, string>();
  const userIds = Array.from(userIdSet);
  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds))
      .all();
    for (const u of userRows) userMap.set(u.id, u.email);
  }

  // ── Build event list ────────────────────────────────────────────────────────

  const events: CustodyEvent[] = [];

  // Package created
  events.push({
    type: "package_created",
    at: pkg.createdAt,
    actor: talentUser?.email ?? "Unknown",
  });

  // Files added
  for (const f of files) {
    events.push({
      type: "file_added",
      at: f.createdAt,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
    });
  }

  // Licence events
  const licenceMap = new Map(licenceRows.map((l) => [l.id, l]));
  const fileMap = new Map(files.map((f) => [f.id, f]));

  for (const l of licenceRows) {
    const licenseeEmail = userMap.get(l.licenseeId) ?? "Unknown";
    const approvedByEmail = l.approvedBy ? (userMap.get(l.approvedBy) ?? "Unknown") : undefined;

    events.push({
      type: "licence_requested",
      at: l.createdAt,
      licenceId: l.id,
      projectName: l.projectName,
      productionCompany: l.productionCompany,
      licensee: licenseeEmail,
      intendedUse: l.intendedUse,
      validFrom: l.validFrom,
      validTo: l.validTo,
    });

    if (l.approvedAt) {
      events.push({
        type: "licence_approved",
        at: l.approvedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
        approvedBy: approvedByEmail,
      });
    }

    if (l.deniedAt) {
      events.push({
        type: "licence_denied",
        at: l.deniedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
        deniedReason: l.deniedReason,
      });
    }

    if (l.revokedAt) {
      events.push({
        type: "licence_revoked",
        at: l.revokedAt,
        licenceId: l.id,
        projectName: l.projectName,
        productionCompany: l.productionCompany,
      });
    }
  }

  // Download events — split by whether it was a licensee or talent's own download
  for (const dl of dlEvents) {
    const file = fileMap.get(dl.fileId);
    const actorEmail = userMap.get(dl.licenseeId) ?? "Unknown";

    if (dl.licenceId) {
      // Licensee dual-custody download
      const licence = licenceMap.get(dl.licenceId);
      events.push({
        type: "file_downloaded",
        at: dl.startedAt,
        licenceId: dl.licenceId,
        projectName: licence?.projectName,
        productionCompany: licence?.productionCompany,
        licensee: actorEmail,
        filename: file?.filename,
        sizeBytes: file?.sizeBytes,
        bytesTransferred: dl.bytesTransferred,
        ip: dl.ip,
        userAgent: dl.userAgent,
        completedAt: dl.completedAt,
      });
    } else {
      // Talent's own direct download
      events.push({
        type: "talent_downloaded",
        at: dl.startedAt,
        actor: actorEmail,
        filename: file?.filename,
        sizeBytes: file?.sizeBytes,
        bytesTransferred: dl.bytesTransferred,
        ip: dl.ip,
        userAgent: dl.userAgent,
        completedAt: dl.completedAt,
      });
    }
  }

  // Sort chronologically
  events.sort((a, b) => a.at - b.at);

  const response: ActivityResponse = {
    package: {
      id: pkg.id,
      name: pkg.name,
      captureDate: pkg.captureDate ?? null,
      studioName: pkg.studioName ?? null,
      talentEmail: talentUser?.email ?? "Unknown",
      createdAt: pkg.createdAt,
    },
    events,
    generatedAt: Math.floor(Date.now() / 1000),
  };

  return NextResponse.json(response);
}
