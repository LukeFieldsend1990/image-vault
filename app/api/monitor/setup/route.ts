import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

/**
 * The two documents Meta wants before we can act on the talent's behalf. Kept
 * on the server as constants so the endpoint and the client agree on names
 * without a shared types file — string mismatch here silently disables uploads.
 */
const KINDS = new Set(["letter", "id"] as const);
type DocKind = "letter" | "id";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — big enough for a scanned PDF, small enough to buffer at the edge.
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

// GET /api/monitor/setup — return the current upload state so the settings
// page can show "letter ✓, id pending" without exposing R2 keys to the client.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts have a monitor setup" }, { status: 403 });
  }

  const db = getDb();
  const profile = await db
    .select({
      agentLetterUploadedAt: talentProfiles.agentLetterUploadedAt,
      idDocumentUploadedAt: talentProfiles.idDocumentUploadedAt,
      enforcementAuthorizationOnFile: talentProfiles.enforcementAuthorizationOnFile,
      authorizationReviewStatus: talentProfiles.authorizationReviewStatus,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.sub))
    .get();

  if (!profile) {
    return NextResponse.json({ error: "Talent profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    letter: { uploaded: profile.agentLetterUploadedAt !== null, uploadedAt: profile.agentLetterUploadedAt },
    id: { uploaded: profile.idDocumentUploadedAt !== null, uploadedAt: profile.idDocumentUploadedAt },
    enforcementAuthorizationOnFile: profile.enforcementAuthorizationOnFile,
    reviewStatus: profile.authorizationReviewStatus,
  });
}

// POST /api/monitor/setup — upload one document (kind = letter | id). Multipart
// form: { kind, file }. Streams straight to R2 rather than reading the whole
// file into memory; the Worker's memory budget cannot buffer a 10 MB PDF as an
// ArrayBuffer for every parallel signup.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can upload setup docs" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }

  const kindRaw = form.get("kind");
  if (typeof kindRaw !== "string" || !KINDS.has(kindRaw as DocKind)) {
    return NextResponse.json({ error: "kind must be one of: letter, id" }, { status: 400 });
  }
  const kind = kindRaw as DocKind;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field missing" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Allowed: PDF, JPEG, PNG, HEIC, WebP.` },
      { status: 415 }
    );
  }

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as { SCANS_BUCKET?: R2Bucket }).SCANS_BUCKET;
  if (!bucket) {
    return NextResponse.json({ error: "R2 bucket not bound" }, { status: 500 });
  }

  const ext = pickExt(file.type);
  const uuid = crypto.randomUUID();
  const r2Key = `monitor-legal/${session.sub}/${kind}-${uuid}${ext}`;

  await bucket.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      talentId: session.sub,
      kind,
      originalName: file.name.slice(0, 200),
      uploadedAt: String(Math.floor(Date.now() / 1000)),
    },
  });

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const updates =
    kind === "letter"
      ? { agentLetterKey: r2Key, agentLetterUploadedAt: now }
      : { idDocumentKey: r2Key, idDocumentUploadedAt: now };

  await db.update(talentProfiles).set(updates).where(eq(talentProfiles.userId, session.sub));

  // Now that this doc is on file, check whether the talent has completed both.
  // If so, flip enforcement_authorization_on_file so the Send-report button
  // becomes available. Review remains `self_declared` — admin still needs to
  // eyeball the paperwork before we treat it as verified at scale.
  const after = await db
    .select({
      letter: talentProfiles.agentLetterKey,
      id: talentProfiles.idDocumentKey,
      enforcement: talentProfiles.enforcementAuthorizationOnFile,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.sub))
    .get();

  let enforcementFlipped = false;
  if (after?.letter && after?.id && !after.enforcement) {
    await db
      .update(talentProfiles)
      .set({ enforcementAuthorizationOnFile: true })
      .where(eq(talentProfiles.userId, session.sub));
    enforcementFlipped = true;
  }

  return NextResponse.json({
    ok: true,
    kind,
    uploadedAt: now,
    enforcementAuthorizationOnFile: enforcementFlipped || after?.enforcement === true,
  });
}

function pickExt(type: string): string {
  if (type === "application/pdf") return ".pdf";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/heic") return ".heic";
  if (type === "image/heif") return ".heif";
  if (type === "image/webp") return ".webp";
  return "";
}
