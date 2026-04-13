export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles, talentProfiles, talentLicencePermissions } from "@/lib/db/schema";
import { eq, sql, and, desc, isNull } from "drizzle-orm";
import TalentProfileClient from "./talent-profile-client";

const LICENCE_TYPES = [
  "commercial",
  "film_double",
  "game_character",
  "ai_avatar",
  "training_data",
  "monitoring_reference",
] as const;

type LicenceType = (typeof LICENCE_TYPES)[number];
type Permission = "allowed" | "approval_required" | "blocked";

const PERMISSION_DEFAULTS: Record<LicenceType, Permission> = {
  commercial: "approval_required",
  film_double: "approval_required",
  game_character: "approval_required",
  ai_avatar: "approval_required",
  training_data: "blocked",
  monitoring_reference: "allowed",
};

async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) return null;
  try {
    return JSON.parse(atob(session.split(".")[1])) as { sub: string; role: string };
  } catch { return null; }
}

export default async function TalentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const db = getDb();

  const [talent] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "talent")))
    .limit(1)
    .all();

  if (!talent) redirect("/directory");

  const [profile, permRows, packages] = await Promise.all([
    db.select({
      fullName: talentProfiles.fullName,
      profileImageUrl: talentProfiles.profileImageUrl,
      tmdbId: talentProfiles.tmdbId,
      knownFor: talentProfiles.knownFor,
    })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, id))
      .get(),

    db.select({
      licenceType: talentLicencePermissions.licenceType,
      permission: talentLicencePermissions.permission,
    })
      .from(talentLicencePermissions)
      .where(eq(talentLicencePermissions.talentId, id))
      .all(),

    db.select({
      id: scanPackages.id,
      name: scanPackages.name,
      description: scanPackages.description,
      captureDate: scanPackages.captureDate,
      studioName: scanPackages.studioName,
      totalSizeBytes: scanPackages.totalSizeBytes,
      coverImageKey: scanPackages.coverImageKey,
      fileCount: sql<number>`count(${scanFiles.id})`.as("file_count"),
    })
      .from(scanPackages)
      .leftJoin(scanFiles, and(
        eq(scanFiles.packageId, scanPackages.id),
        eq(scanFiles.uploadStatus, "complete"),
      ))
      .where(and(eq(scanPackages.talentId, id), eq(scanPackages.status, "ready"), isNull(scanPackages.deletedAt)))
      .groupBy(scanPackages.id)
      .orderBy(desc(scanPackages.createdAt))
      .all(),
  ]);

  // Build permissions with defaults
  const permMap = Object.fromEntries(permRows.map((r) => [r.licenceType, r.permission])) as Record<string, Permission>;
  const permissions = LICENCE_TYPES.map((type) => ({
    licenceType: type,
    permission: (permMap[type] as Permission | undefined) ?? PERMISSION_DEFAULTS[type],
  }));

  // Capabilities from file extensions
  const packageIds = packages.map((p) => p.id);
  let capabilities: string[] = [];
  if (packageIds.length > 0) {
    const files = await db
      .select({ filename: scanFiles.filename })
      .from(scanFiles)
      .where(and(
        sql`${scanFiles.packageId} IN (${sql.join(packageIds.map((pid) => sql`${pid}`), sql`, `)})`,
        eq(scanFiles.uploadStatus, "complete"),
      ))
      .all();

    const exts = new Set(files.map((f) => f.filename.split(".").pop()?.toLowerCase() ?? ""));
    const caps: string[] = [];
    if (exts.has("raw") || exts.has("cr2") || exts.has("cr3") || exts.has("tiff") || exts.has("tif")) caps.push("Photoreal digital double source");
    if (exts.has("obj") || exts.has("fbx")) caps.push("Real-time mesh (Unreal / Unity compatible)");
    if (exts.has("mp4") || exts.has("mov")) caps.push("360° reference capture");
    if (exts.has("exr")) caps.push("HDR lighting data");
    if (exts.has("jpg") || exts.has("jpeg")) caps.push("Preview image gallery");
    if (exts.has("ma") || exts.has("mb") || exts.has("abc")) caps.push("Facial performance capture data");
    // Always include these for light-stage quality scans — at least one ready package qualifies
    if (packages.length > 0 && caps.length === 0) caps.push("Scan data available");
    capabilities = caps;
  }

  const knownFor = profile?.knownFor ? JSON.parse(profile.knownFor) as { title: string; year?: number; type: string }[] : [];

  // Deepfake Protection (monitoring_reference) is internal — hide from licensees
  const visiblePermissions = session.role === "licensee"
    ? permissions.filter((p) => p.licenceType !== "monitoring_reference")
    : permissions;

  return (
    <TalentProfileClient
      talentId={id}
      talent={talent}
      profile={profile ? { ...profile, knownFor } : null}
      permissions={visiblePermissions}
      capabilities={capabilities}
      packages={packages}
    />
  );
}
