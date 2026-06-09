export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { pitchVignettes, scanPackages, talentReps, talentProfiles } from "@/lib/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

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

  if (session.role !== "rep" && session.role !== "admin") {
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
  const admin = session.role === "admin" || isAdmin(session.email);

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
    sourceImageKeys: JSON.stringify(sourceImageKeys ?? []),
    status: "pending",
    createdAt: now,
  });

  // Enqueue to higgs-worker
  const { env } = getRequestContext();
  const queue = (env as Record<string, unknown>).PITCH_QUEUE as Queue | undefined;
  if (queue) {
    await queue.send({ pitchId: id });
  }

  return NextResponse.json({ id, status: "pending" }, { status: 201 });
}
