export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanFiles, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { and, eq } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

const PREVIEW_TTL = 300; // 5-minute presigned URLs
const MAX_PREVIEW_IMAGES = 24;

// Maps file extension → display category
const EXT_TO_CATEGORY: Record<string, string> = {
  cr2: "raw",  arw: "raw",
  exr: "exr",
  jpeg: "jpeg", jpg: "jpeg",
  xmp: "meta",
  obj: "mesh",  fbx: "mesh",  ma: "mesh",
  mp4: "video",
  html: "360viewer",
  pdf: "docs",
};

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  raw:       { label: "RAW Captures",    description: "Full-res camera RAW files (Canon CR2 / Sony ARW)" },
  exr:       { label: "OpenEXR / HDR",   description: "HDR image data for compositing and lighting" },
  jpeg:      { label: "JPEG Previews",   description: "Quick-access preview thumbnails" },
  meta:      { label: "XMP Metadata",    description: "Camera calibration sidecar files" },
  mesh:      { label: "3D Meshes",       description: "Geometry in HR / MR / LR resolution tiers" },
  video:     { label: "Reference Video", description: "360° reference footage" },
  "360viewer": { label: "360° Viewer",   description: "Interactive panorama viewer files" },
  docs:      { label: "Documents",       description: "Deliverables specification" },
  other:     { label: "Other",           description: "Additional files" },
};

export interface FileTypeStat {
  category: string;
  label: string;
  description: string;
  count: number;
  totalBytes: number;
}

export interface PreviewResponse {
  images: { url: string; filename: string }[];
  mp4Url: string | null;
  stats: FileTypeStat[];
  totalFiles: number;
  totalSizeBytes: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const pkg = await db
    .select({ id: scanPackages.id, talentId: scanPackages.talentId, status: scanPackages.status })
    .from(scanPackages)
    .where(eq(scanPackages.id, id))
    .get();

  if (!pkg || pkg.status !== "ready") {
    return NextResponse.json({ error: "Package not found" }, { status: 404 });
  }

  // Owner, rep, or any authenticated licensee/admin can view preview of a ready package
  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  const isAdmin = session.role === "admin" || ADMIN_EMAILS.includes(session.email);
  const isBrowser = session.role === "licensee" || isAdmin;
  if (!isOwner && !isRep && !isBrowser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const files = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename, sizeBytes: scanFiles.sizeBytes, r2Key: scanFiles.r2Key })
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, id), eq(scanFiles.uploadStatus, "complete")))
    .all();

  // ── Stats breakdown ────────────────────────────────────────────────────────
  const categoryMap = new Map<string, FileTypeStat>();
  for (const f of files) {
    const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
    const cat = EXT_TO_CATEGORY[ext] ?? "other";
    const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { category: cat, label: meta.label, description: meta.description, count: 0, totalBytes: 0 });
    }
    const s = categoryMap.get(cat)!;
    s.count++;
    s.totalBytes += f.sizeBytes;
  }
  const stats = [...categoryMap.values()].sort((a, b) => b.totalBytes - a.totalBytes);

  const totalFiles = files.length;
  const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  // ?stats=1 — return only the breakdown, no presigned URLs (fast, for always-visible cards)
  const statsOnly = new URL(req.url).searchParams.get("stats") === "1";
  if (statsOnly) {
    return NextResponse.json({ images: [], mp4Url: null, stats, totalFiles, totalSizeBytes } satisfies PreviewResponse);
  }

  // ── Presign JPEG previews ──────────────────────────────────────────────────
  const jpegFiles = files
    .filter(f => /\.(jpeg|jpg)$/i.test(f.filename))
    .slice(0, MAX_PREVIEW_IMAGES);

  const mp4File = files.find(f => /\.mp4$/i.test(f.filename)) ?? null;

  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";

  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });

  async function presignGet(r2Key: string): Promise<string> {
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`);
    url.searchParams.set("X-Amz-Expires", String(PREVIEW_TTL));
    const signed = await r2.sign(new Request(url.toString(), { method: "GET" }), { aws: { signQuery: true } });
    return signed.url;
  }

  const [images, mp4Url] = await Promise.all([
    Promise.all(jpegFiles.map(async (f) => ({ url: await presignGet(f.r2Key), filename: f.filename }))),
    mp4File ? presignGet(mp4File.r2Key) : Promise.resolve(null),
  ]);

  return NextResponse.json({ images, mp4Url, stats, totalFiles, totalSizeBytes } satisfies PreviewResponse);
}
