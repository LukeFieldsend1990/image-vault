import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { trialReferencePhotos, trialScans } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import { MAX_TRIAL_PHOTOS, TRIAL_REFS_R2_PREFIX } from "@/lib/monitor/trial";
import { and, eq, sql } from "drizzle-orm";

// POST /api/scout/:id/photos — upload one piece of reference material for a
// draft trial. Multipart form: { kind: face | full_body | scan_3d, file }.
// Face angles and body shots feed the identity matcher; a 3D scan raises the
// coverage tier. Streams to R2, same as the monitor setup uploads.

const KINDS = new Set(["face", "full_body", "scan_3d"] as const);
type PhotoKind = "face" | "full_body" | "scan_3d";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SCAN_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
// 3D uploads arrive with unreliable MIME types (often octet-stream), so the
// gate is the filename extension.
const SCAN_EXT = /\.(glb|gltf|obj|fbx|ply|stl|usdz|zip)$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const trial = await db
    .select({ id: trialScans.id, status: trialScans.status })
    .from(trialScans)
    .where(and(eq(trialScans.id, id), eq(trialScans.requestedBy, session.sub)))
    .get();
  if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });
  if (trial.status !== "draft") {
    return NextResponse.json({ error: "Reference material can only be added before the sweep runs" }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });

  const kindRaw = form.get("kind");
  if (typeof kindRaw !== "string" || !KINDS.has(kindRaw as PhotoKind)) {
    return NextResponse.json({ error: "kind must be one of: face, full_body, scan_3d" }, { status: 400 });
  }
  const kind = kindRaw as PhotoKind;

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file field missing" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });

  if (kind === "scan_3d") {
    if (!SCAN_EXT.test(file.name)) {
      return NextResponse.json(
        { error: "Unsupported 3D format. Allowed: GLB, GLTF, OBJ, FBX, PLY, STL, USDZ, ZIP." },
        { status: 415 }
      );
    }
    if (file.size > MAX_SCAN_BYTES) {
      return NextResponse.json(
        { error: `3D scan too large (max ${MAX_SCAN_BYTES / 1024 / 1024} MB for trials)` },
        { status: 413 }
      );
    }
  } else {
    if (!IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type "${file.type}". Allowed: JPEG, PNG, WebP, HEIC.` },
        { status: 415 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }
  }

  const counts = await db
    .select({
      total: sql<number>`count(*)`,
      scans: sql<number>`sum(case when ${trialReferencePhotos.kind} = 'scan_3d' then 1 else 0 end)`,
    })
    .from(trialReferencePhotos)
    .where(eq(trialReferencePhotos.trialId, id))
    .get();
  if ((counts?.total ?? 0) >= MAX_TRIAL_PHOTOS) {
    return NextResponse.json(
      { error: `Reference set is full (max ${MAX_TRIAL_PHOTOS} uploads)` },
      { status: 409 }
    );
  }
  if (kind === "scan_3d" && (counts?.scans ?? 0) >= 1) {
    return NextResponse.json({ error: "One 3D scan per trial" }, { status: 409 });
  }

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
  if (!bucket) return NextResponse.json({ error: "R2 bucket not bound" }, { status: 500 });

  const ext = pickExt(file.type, file.name);
  const photoId = crypto.randomUUID();
  const r2Key = `${TRIAL_REFS_R2_PREFIX}${id}/${kind}-${photoId}${ext}`;

  await bucket.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: {
      trialId: id,
      uploadedBy: session.sub,
      kind,
      originalName: file.name.slice(0, 200),
      uploadedAt: String(Math.floor(Date.now() / 1000)),
    },
  });

  await db.insert(trialReferencePhotos).values({
    id: photoId,
    trialId: id,
    r2Key,
    kind,
    originalName: file.name.slice(0, 200),
    contentType: file.type || null,
    sizeBytes: file.size,
    createdAt: Math.floor(Date.now() / 1000),
  });

  return NextResponse.json({ ok: true, photoId, kind }, { status: 201 });
}

function pickExt(type: string, filename: string): string {
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/heic") return ".heic";
  if (type === "image/heif") return ".heif";
  const m = filename.match(/(\.[a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}
