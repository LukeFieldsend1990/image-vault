import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { pitchVignettes, scanPackages, talentReps, talentProfiles, scanFiles } from "@/lib/db/schema";
import { eq, and, isNull, desc, inArray, like } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// GET /api/pitch?packageId=<uuid>  — list vignettes for a package
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const packageId = req.nextUrl.searchParams.get("packageId");
  if (!packageId) return NextResponse.json({ error: "packageId required" }, { status: 400 });

  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);

  // Fetch package to check ownership
  const pkg = await db.select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Authorise: talent themselves, their rep, or admin
  if (!admin && session.sub !== pkg.talentId) {
    if (session.role !== "rep") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const link = await db.select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, pkg.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const vignettes = await db.select()
    .from(pitchVignettes)
    .where(and(eq(pitchVignettes.packageId, packageId), isNull(pitchVignettes.deletedAt)))
    .orderBy(desc(pitchVignettes.createdAt))
    .all();

  return NextResponse.json({ vignettes });
}

// POST /api/pitch  — queue a new pitch vignette generation
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const admin = session.role === "admin" || isAdmin(session.email);
  if (session.role !== "rep" && !admin) {
    return NextResponse.json({ error: "Only reps can generate pitch vignettes" }, { status: 403 });
  }

  let body: {
    packageId?: string;
    productionName?: string;
    characterDescription?: string;
    tone?: string;
    includeAudio?: boolean;
    sourceImageKeys?: string[];
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { packageId, productionName, characterDescription, tone, includeAudio, sourceImageKeys } = body;
  if (!packageId || !productionName || !characterDescription) {
    return NextResponse.json({ error: "packageId, productionName and characterDescription are required" }, { status: 400 });
  }

  const db = getDb();

  const pkg = await db.select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(and(eq(scanPackages.id, packageId), isNull(scanPackages.deletedAt)))
    .get();

  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Rep must manage this talent
  if (!admin) {
    const link = await db.select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, pkg.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check talent has not opted out
  const profile = await db.select({ pitchVignettesEnabled: talentProfiles.pitchVignettesEnabled })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, pkg.talentId))
    .get();

  if (profile && profile.pitchVignettesEnabled === false) {
    return NextResponse.json({ error: "Talent has disabled pitch vignette generation" }, { status: 403 });
  }

  // Validate the chosen source images actually belong to this package and are
  // images. The worker presigns these keys into publicly-fetchable URLs, so we
  // must never store a key the caller doesn't own.
  const requestedKeys = Array.from(new Set((sourceImageKeys ?? []).filter((k): k is string => typeof k === "string")));
  if (requestedKeys.length === 0) {
    return NextResponse.json({ error: "At least one source image is required" }, { status: 400 });
  }

  const ownedRows = await db.select({ r2Key: scanFiles.r2Key })
    .from(scanFiles)
    .where(and(
      eq(scanFiles.packageId, packageId),
      inArray(scanFiles.r2Key, requestedKeys),
      like(scanFiles.contentType, "image/%"),
    ))
    .all();

  const validKeys = ownedRows.map((r) => r.r2Key);
  if (validKeys.length === 0) {
    return NextResponse.json({ error: "No valid source images for this package" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insert(pitchVignettes).values({
    id,
    talentId: pkg.talentId,
    packageId,
    createdBy: session.sub,
    productionName,
    characterDescription,
    tone: tone ?? "dramatic",
    includeAudio: includeAudio ?? false,
    sourceImageKeys: JSON.stringify(validKeys),
    status: "pending",
    createdAt: now,
  });

  // Enqueue to higgs-worker
  const { env } = getCloudflareContext();
  const queue = (env as unknown as { PITCH_QUEUE?: Queue }).PITCH_QUEUE;
  if (queue) {
    await queue.send({ pitchId: id });
  }

  return NextResponse.json({ id, status: "pending" }, { status: 201 });
}
