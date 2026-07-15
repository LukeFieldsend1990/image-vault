import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users, scanPackages, scanFiles, talentProfiles, talentLicencePermissions, packageTags } from "@/lib/db/schema";
import { eq, sql, and, desc, isNull, inArray } from "drizzle-orm";
import TalentProfileClient from "./talent-profile-client";
import { isIndustryRole } from "@/lib/auth/roles";
import { resolveLicencePermissions } from "@/lib/consent/licence-permissions";
import { loadStandingInstructions } from "@/lib/consent/standing-instructions";

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
    .select({ id: users.id, email: users.email, shortCode: users.shortCode })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "talent")))
    .limit(1)
    .all();

  if (!talent) redirect("/directory");

  const [profile, permRows, instructions, packages] = await Promise.all([
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

    // Standing instructions — source of truth for consent-owned licence types
    loadStandingInstructions(db, id),

    db.select({
      id: scanPackages.id,
      name: scanPackages.name,
      scanNumber: scanPackages.scanNumber,
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

  const permissions = resolveLicencePermissions(permRows, instructions);

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

  // Fetch AI-generated tags for packages
  const aiTags = packageIds.length > 0
    ? await db
        .select({
          packageId: packageTags.packageId,
          tag: packageTags.tag,
          category: packageTags.category,
          status: packageTags.status,
        })
        .from(packageTags)
        .where(inArray(packageTags.packageId, packageIds))
        .all()
    : [];

  const tagsByPackage: Record<string, { tag: string; category: string; status: string }[]> = {};
  for (const t of aiTags) {
    (tagsByPackage[t.packageId] ??= []).push(t);
  }

  const packagesWithTags = packages.map((p) => ({
    ...p,
    aiTags: tagsByPackage[p.id] ?? [],
  }));

  // Deepfake Protection (monitoring_reference) is internal — hide from licensees and reps (directory view)
  const visiblePermissions = (isIndustryRole(session.role) || session.role === "rep")
    ? permissions.filter((p) => p.licenceType !== "monitoring_reference")
    : permissions;

  return (
    <TalentProfileClient
      talentId={id}
      talent={talent}
      profile={profile ? { ...profile, knownFor } : null}
      permissions={visiblePermissions}
      capabilities={capabilities}
      packages={packagesWithTags}
      viewerRole={session.role}
    />
  );
}
