/**
 * Digital Double Pipeline Worker
 *
 * Queue consumer for `pipeline-jobs`. Processes scan packages into tiered
 * commercial deliverable bundles (preview / realtime / vfx).
 *
 * Stages:
 *   1. validate   — check required file types present, build file manifest
 *   2. classify   — EXR texture pass classification (filename heuristic → Workers AI fallback)
 *   3. assemble   — generate Unreal manifest JSON + README
 *   4. bundle     — stream ZIP per SKU → upload to PIPELINE_BUCKET
 *   5. notify     — Resend email to talent + initiator
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";
import {
  pipelineJobs,
  pipelineStages,
  pipelineOutputs,
  scanFiles,
  scanPackages,
  users,
} from "./schema";

// ── Types ──────────────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
  SCANS_BUCKET: R2Bucket;
  PIPELINE_BUCKET: R2Bucket;
  AI: Ai;
  RESEND_API_KEY?: string;
  MESHY_API_KEY?: string;
  RESEND_FROM_EMAIL: string;
  APP_URL: string;
}

interface JobMessage {
  jobId: string;
}

// ── File classification ────────────────────────────────────────────────────

const EXT_CATEGORY: Record<string, string> = {
  cr2: "raw", arw: "raw",
  exr: "exr",
  jpeg: "jpeg", jpg: "jpeg",
  xmp: "meta",
  obj: "mesh",
  fbx: "rig",
  ma: "dcc",
  mp4: "video",
  html: "viewer360",
  pdf: "docs",
};

function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function categoryOf(filename: string): string {
  return EXT_CATEGORY[extOf(filename)] ?? "other";
}

// LOD detection from filename: *_hr*, *_mr*, *_lr* or fallback
function lodOf(filename: string): "hr" | "mr" | "lr" | null {
  const lower = filename.toLowerCase();
  if (lower.includes("_hr")) return "hr";
  if (lower.includes("_mr")) return "mr";
  if (lower.includes("_lr")) return "lr";
  return null;
}

// EXR texture pass classification by filename heuristic
const EXR_PASS_HINTS: [RegExp, string][] = [
  [/albedo|diffuse|color|colour/i, "albedo"],
  [/normal|nrm/i, "normal"],
  [/roughness|rgh/i, "roughness"],
  [/displacement|disp|height/i, "displacement"],
  [/specular|spec/i, "specular"],
  [/subsurface|sss/i, "subsurface"],
  [/ao|ambient/i, "ao"],
  [/emissive|emission/i, "emissive"],
];

function classifyExrByName(filename: string): string {
  for (const [re, pass] of EXR_PASS_HINTS) {
    if (re.test(filename)) return pass;
  }
  return "unknown";
}

// ── ZIP helpers (no-compression STORE, CRC-32 streaming) ──────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function updateCrc(crc: number, buf: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
}
function writeUint32LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

interface ZipEntry {
  name: string;
  size: number;
  crc32: number;
  offset: number; // byte offset of local header in archive
}

function localFileHeader(nameBytes: Uint8Array, fileSize: number): Uint8Array {
  const extra = new Uint8Array(0);
  const hdr = new Uint8Array(30 + nameBytes.length + extra.length);
  writeUint32LE(hdr, 0, 0x04034b50); // signature
  writeUint16LE(hdr, 4, 20);          // version needed (2.0)
  writeUint16LE(hdr, 6, 0x0008);      // flags: bit 3 = data descriptor follows
  writeUint16LE(hdr, 8, 0);           // compression: STORE
  writeUint16LE(hdr, 10, 0);          // mod time
  writeUint16LE(hdr, 12, 0);          // mod date
  writeUint32LE(hdr, 14, 0);          // crc-32 (deferred to data descriptor)
  writeUint32LE(hdr, 18, fileSize > 0xffffffff ? 0xffffffff : fileSize); // compressed
  writeUint32LE(hdr, 22, fileSize > 0xffffffff ? 0xffffffff : fileSize); // uncompressed
  writeUint16LE(hdr, 26, nameBytes.length);
  writeUint16LE(hdr, 28, extra.length);
  hdr.set(nameBytes, 30);
  return hdr;
}

function dataDescriptor(crc32: number, fileSize: number): Uint8Array {
  if (fileSize > 0xffffffff) {
    // ZIP64 data descriptor
    const dd = new Uint8Array(24);
    writeUint32LE(dd, 0, 0x08074b50);
    writeUint32LE(dd, 4, crc32);
    // 64-bit sizes (little-endian)
    const lo = fileSize & 0xffffffff;
    const hi = Math.floor(fileSize / 0x100000000);
    writeUint32LE(dd, 8, lo); writeUint32LE(dd, 12, hi);   // compressed
    writeUint32LE(dd, 16, lo); writeUint32LE(dd, 20, hi);  // uncompressed
    return dd;
  }
  const dd = new Uint8Array(16);
  writeUint32LE(dd, 0, 0x08074b50);
  writeUint32LE(dd, 4, crc32);
  writeUint32LE(dd, 8, fileSize);
  writeUint32LE(dd, 12, fileSize);
  return dd;
}

function centralDirRecord(entry: ZipEntry, nameBytes: Uint8Array): Uint8Array {
  const rec = new Uint8Array(46 + nameBytes.length);
  writeUint32LE(rec, 0, 0x02014b50);
  writeUint16LE(rec, 4, 20);  // version made by
  writeUint16LE(rec, 6, 20);  // version needed
  writeUint16LE(rec, 8, 0x0008); // flags
  writeUint16LE(rec, 10, 0);  // compression STORE
  writeUint16LE(rec, 12, 0);  // mod time
  writeUint16LE(rec, 14, 0);  // mod date
  writeUint32LE(rec, 16, entry.crc32);
  writeUint32LE(rec, 20, entry.size > 0xffffffff ? 0xffffffff : entry.size);
  writeUint32LE(rec, 24, entry.size > 0xffffffff ? 0xffffffff : entry.size);
  writeUint16LE(rec, 28, nameBytes.length);
  writeUint16LE(rec, 30, 0);  // extra field length
  writeUint16LE(rec, 32, 0);  // file comment length
  writeUint16LE(rec, 34, 0);  // disk number start
  writeUint16LE(rec, 36, 0);  // internal attrs
  writeUint32LE(rec, 38, 0);  // external attrs
  writeUint32LE(rec, 42, entry.offset > 0xffffffff ? 0xffffffff : entry.offset);
  rec.set(nameBytes, 46);
  return rec;
}

function endOfCentralDir(
  entryCount: number,
  cdOffset: number,
  cdSize: number,
): Uint8Array {
  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 4, 0);  // disk number
  writeUint16LE(eocd, 6, 0);  // disk with cd
  writeUint16LE(eocd, 8, Math.min(entryCount, 0xffff));
  writeUint16LE(eocd, 10, Math.min(entryCount, 0xffff));
  writeUint32LE(eocd, 12, cdSize > 0xffffffff ? 0xffffffff : cdSize);
  writeUint32LE(eocd, 16, cdOffset > 0xffffffff ? 0xffffffff : cdOffset);
  writeUint16LE(eocd, 20, 0);
  return eocd;
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function setStageStatus(
  db: ReturnType<typeof drizzle>,
  jobId: string,
  stage: string,
  status: "running" | "complete" | "failed" | "skipped",
  log?: string,
  metadata?: Record<string, unknown>,
) {
  const now = Math.floor(Date.now() / 1000);
  // Find our specific stage
  const allStages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.jobId, jobId))
    .all();

  const stageRow = allStages.find((s) => s.stage === stage);
  if (!stageRow) return;

  const update: Partial<typeof pipelineStages.$inferInsert> = {
    status,
    log: log ?? stageRow.log,
    metadata: metadata ? JSON.stringify(metadata) : stageRow.metadata,
  };
  if (status === "running") update.startedAt = now;
  if (status === "complete" || status === "failed" || status === "skipped") update.completedAt = now;

  await db.update(pipelineStages)
    .set(update)
    .where(eq(pipelineStages.id, stageRow.id));
}

// ── Pipeline stage implementations ────────────────────────────────────────

interface FileRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  r2Key: string;
}

interface FileManifest {
  meshes: { lod: string | null; filename: string; r2Key: string; sizeBytes: number }[];
  rigs: { filename: string; r2Key: string; sizeBytes: number }[];
  dcc: { filename: string; r2Key: string; sizeBytes: number }[];
  exr: { filename: string; r2Key: string; sizeBytes: number }[];
  jpeg: { filename: string; r2Key: string; sizeBytes: number }[];
  video: { filename: string; r2Key: string; sizeBytes: number }[];
  docs: { filename: string; r2Key: string; sizeBytes: number }[];
  other: { filename: string; r2Key: string; sizeBytes: number }[];
  raw: { filename: string; r2Key: string; sizeBytes: number }[];
  meta: { filename: string; r2Key: string; sizeBytes: number }[];
}

async function stage1Validate(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
  packageId: string,
  r2Prefix: string,
): Promise<FileManifest> {
  await setStageStatus(db, jobId, "validate", "running");

  const files = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename, sizeBytes: scanFiles.sizeBytes, r2Key: scanFiles.r2Key })
    .from(scanFiles)
    .where(eq(scanFiles.packageId, packageId))
    .all();

  if (files.length === 0) {
    await setStageStatus(db, jobId, "validate", "failed", "No files found in package");
    throw new Error("No files found in package");
  }

  const manifest: FileManifest = {
    meshes: [], rigs: [], dcc: [], exr: [], jpeg: [], video: [], docs: [], other: [], raw: [], meta: [],
  };

  for (const f of files) {
    const cat = categoryOf(f.filename);
    const entry = { filename: f.filename, r2Key: f.r2Key, sizeBytes: f.sizeBytes };
    if (cat === "mesh") manifest.meshes.push({ ...entry, lod: lodOf(f.filename) });
    else if (cat === "rig") manifest.rigs.push(entry);
    else if (cat === "dcc") manifest.dcc.push(entry);
    else if (cat === "exr") manifest.exr.push(entry);
    else if (cat === "jpeg") manifest.jpeg.push(entry);
    else if (cat === "video") manifest.video.push(entry);
    else if (cat === "docs") manifest.docs.push(entry);
    else if (cat === "raw") manifest.raw.push(entry);
    else if (cat === "meta") manifest.meta.push(entry);
    else manifest.other.push(entry);
  }

  // Validation checks
  const warnings: string[] = [];
  if (manifest.meshes.length === 0) warnings.push("No mesh files found");
  if (manifest.rigs.length === 0) warnings.push("No FBX rig file found");
  if (manifest.exr.length === 0) warnings.push("No EXR texture passes found");
  if (manifest.jpeg.length === 0) warnings.push("No JPEG preview images found");

  // Write manifest to pipeline R2
  await env.PIPELINE_BUCKET.put(
    `${r2Prefix}/manifests/file_manifest.json`,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  await setStageStatus(db, jobId, "validate", "complete",
    `${files.length} files classified. ${warnings.length > 0 ? "Warnings: " + warnings.join(", ") : "All checks passed."}`,
    { fileCount: files.length, warnings },
  );

  return manifest;
}

interface TextureManifest {
  passes: { pass: string; filename: string; r2Key: string; classified: "filename" | "ai" | "unknown" }[];
}

async function stage2Classify(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
  manifest: FileManifest,
  r2Prefix: string,
): Promise<TextureManifest> {
  await setStageStatus(db, jobId, "classify", "running");

  const textureManifest: TextureManifest = { passes: [] };

  for (const exr of manifest.exr) {
    const passByName = classifyExrByName(exr.filename);

    if (passByName !== "unknown") {
      textureManifest.passes.push({
        pass: passByName,
        filename: exr.filename,
        r2Key: exr.r2Key,
        classified: "filename",
      });
    } else {
      // Fallback: try Workers AI vision classification on the EXR
      // EXRs can be large; Workers AI needs a manageable image.
      // For now, mark as unknown and note for manual review.
      // TODO Phase 2: fetch EXR thumbnail/first bytes and run through AI
      textureManifest.passes.push({
        pass: "unknown",
        filename: exr.filename,
        r2Key: exr.r2Key,
        classified: "unknown",
      });
    }
  }

  const classified = textureManifest.passes.filter((p) => p.classified === "filename").length;
  const unknown = textureManifest.passes.filter((p) => p.classified === "unknown").length;

  await env.PIPELINE_BUCKET.put(
    `${r2Prefix}/manifests/texture_manifest.json`,
    JSON.stringify(textureManifest, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  await setStageStatus(db, jobId, "classify", "complete",
    `${classified} passes classified by filename, ${unknown} unknown.`,
    { classified, unknown },
  );

  return textureManifest;
}

async function stage3Assemble(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
  packageId: string,
  manifest: FileManifest,
  textureManifest: TextureManifest,
  r2Prefix: string,
  packageName: string,
) {
  await setStageStatus(db, jobId, "assemble", "running");

  const enc = new TextEncoder();

  // Build Unreal manifest
  const lodConfig = {
    LOD0: manifest.meshes.find((m) => m.lod === "hr") ?? manifest.meshes[0] ?? null,
    LOD1: manifest.meshes.find((m) => m.lod === "mr") ?? null,
    LOD2: manifest.meshes.find((m) => m.lod === "lr") ?? null,
  };

  const unrealManifest = {
    packageId,
    packageName,
    generatedAt: new Date().toISOString(),
    meshes: {
      skeletalRig: manifest.rigs[0]?.filename ?? null,
      mayaScene: manifest.dcc[0]?.filename ?? null,
      lods: lodConfig,
    },
    textures: textureManifest.passes.reduce<Record<string, string>>((acc, p) => {
      if (p.pass !== "unknown") acc[p.pass] = p.filename;
      return acc;
    }, {}),
    references: {
      video360: manifest.video[0]?.filename ?? null,
      docs: manifest.docs.map((d) => d.filename),
    },
    notes: [
      "Import LOD0 FBX into Unreal Engine as Skeletal Mesh.",
      "Assign LOD1/LOD2 meshes in the LOD settings panel.",
      "Apply texture maps to the material slots as indicated above.",
      "Source EXR files are included for full-quality DCC work.",
    ],
  };

  await env.PIPELINE_BUCKET.put(
    `${r2Prefix}/manifests/unreal_manifest.json`,
    JSON.stringify(unrealManifest, null, 2),
    { httpMetadata: { contentType: "application/json" } },
  );

  // README
  const readmeParts = [
    `# ${packageName} — Digital Double Package`,
    ``,
    `Generated: ${new Date().toUTCString()}`,
    ``,
    `## Contents`,
    ``,
    `### Meshes`,
    `- LOD0 (HR): ${lodConfig.LOD0?.filename ?? "not found"}`,
    `- LOD1 (MR): ${lodConfig.LOD1?.filename ?? "not found"}`,
    `- LOD2 (LR): ${lodConfig.LOD2?.filename ?? "not found"}`,
    `- Skeletal rig (FBX): ${manifest.rigs[0]?.filename ?? "not found"}`,
    manifest.dcc[0] ? `- Maya scene: ${manifest.dcc[0].filename}` : "",
    ``,
    `### Texture Passes (EXR)`,
    ...textureManifest.passes.map((p) => `- ${p.pass}: ${p.filename}`),
    ``,
    `### Additional Files`,
    `- JPEG previews: ${manifest.jpeg.length} files`,
    `- 360° reference video: ${manifest.video[0]?.filename ?? "none"}`,
    `- Documents: ${manifest.docs.map((d) => d.filename).join(", ") || "none"}`,
    ``,
    `## Unreal Engine Import Notes`,
    `1. Import the FBX skeletal mesh into your Content Browser.`,
    `2. Assign LOD1 and LOD2 meshes via the LOD settings panel.`,
    `3. Create a material instance and assign EXR-derived textures to the correct slots.`,
    `4. Refer to unreal_manifest.json for the full asset mapping.`,
    ``,
    `## Licence`,
    `This package is licensed for use as specified in your signed licence agreement.`,
    `Unauthorised distribution or sublicensing is prohibited.`,
  ].filter((l) => l !== "").join("\n");

  await env.PIPELINE_BUCKET.put(
    `${r2Prefix}/README.md`,
    enc.encode(readmeParts),
    { httpMetadata: { contentType: "text/markdown" } },
  );

  await setStageStatus(db, jobId, "assemble", "complete",
    "Unreal manifest and README generated.",
    { lods: Object.keys(lodConfig).filter((k) => lodConfig[k as keyof typeof lodConfig] !== null) },
  );
}

// Build a ZIP in memory from a list of named files fetched from R2
// For very large archives this uses R2 multipart upload to avoid memory limits
async function buildAndUploadZip(
  env: Env,
  sourceFiles: { zipPath: string; r2Key: string; content?: Uint8Array }[],
  outputKey: string,
): Promise<number> {
  // For manageable SKU sizes, buffer the full ZIP in memory.
  // Phase 2: switch to multipart upload for VFX SKUs > 1GB.
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of sourceFiles) {
    let data: Uint8Array;
    if (file.content) {
      data = file.content;
    } else {
      const obj = await env.SCANS_BUCKET.get(file.r2Key);
      if (!obj) continue; // skip missing files gracefully
      data = new Uint8Array(await obj.arrayBuffer());
    }

    const nameBytes = enc.encode(file.zipPath);
    const localHdr = localFileHeader(nameBytes, data.byteLength);
    const crc = updateCrc(0, data);
    const dd = dataDescriptor(crc, data.byteLength);

    entries.push({ name: file.zipPath, size: data.byteLength, crc32: crc, offset });
    offset += localHdr.byteLength + data.byteLength + dd.byteLength;

    chunks.push(localHdr, data, dd);
  }

  // Central directory
  const cdStart = offset;
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    chunks.push(centralDirRecord(entry, nameBytes));
    offset += 46 + nameBytes.length;
  }
  const cdSize = offset - cdStart;
  chunks.push(endOfCentralDir(entries.length, cdStart, cdSize));

  // Concatenate all chunks
  const totalSize = chunks.reduce((s, c) => s + c.byteLength, 0);
  const zip = new Uint8Array(totalSize);
  let pos = 0;
  for (const c of chunks) {
    zip.set(c, pos);
    pos += c.byteLength;
  }

  await env.PIPELINE_BUCKET.put(outputKey, zip, {
    httpMetadata: { contentType: "application/zip" },
  });

  return totalSize;
}

async function stage4Bundle(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
  manifest: FileManifest,
  requestedSkus: string[],
  r2Prefix: string,
  packageName: string,
) {
  await setStageStatus(db, jobId, "bundle", "running");

  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);

  // Fetch manifest files (already in PIPELINE_BUCKET)
  async function pipelineFile(key: string, zipPath: string): Promise<{ zipPath: string; r2Key: string; content: Uint8Array } | null> {
    const obj = await env.PIPELINE_BUCKET.get(key);
    if (!obj) return null;
    return { zipPath, r2Key: key, content: new Uint8Array(await obj.arrayBuffer()) };
  }

  const manifestFiles = (await Promise.all([
    pipelineFile(`${r2Prefix}/manifests/file_manifest.json`, "manifests/file_manifest.json"),
    pipelineFile(`${r2Prefix}/manifests/texture_manifest.json`, "manifests/texture_manifest.json"),
    pipelineFile(`${r2Prefix}/manifests/unreal_manifest.json`, "manifests/unreal_manifest.json"),
    pipelineFile(`${r2Prefix}/README.md`, "README.md"),
  ])).filter(Boolean) as { zipPath: string; r2Key: string; content: Uint8Array }[];

  const outputs: { sku: string; r2Key: string; filename: string; sizeBytes: number }[] = [];

  for (const sku of requestedSkus) {
    let skuFiles: { zipPath: string; r2Key: string; content?: Uint8Array }[] = [];
    const safeName = packageName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    const filename = `${safeName}_${sku}.zip`;
    const outputKey = `${r2Prefix}/output/${filename}`;

    if (sku === "preview") {
      // JPEG set + 360 MP4 + manifests
      skuFiles = [
        ...manifest.jpeg.map((f, i) => ({ zipPath: `previews/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.video.map((f) => ({ zipPath: `video/${f.filename}`, r2Key: f.r2Key })),
        ...manifestFiles,
      ];
    } else if (sku === "realtime") {
      // LR + MR mesh + FBX + EXR textures + docs + manifests
      const realtimeMeshes = manifest.meshes.filter((m) => m.lod === "lr" || m.lod === "mr");
      skuFiles = [
        ...realtimeMeshes.map((f) => ({ zipPath: `meshes/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.rigs.map((f) => ({ zipPath: `rig/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.exr.map((f) => ({ zipPath: `textures/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.docs.map((f) => ({ zipPath: `docs/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.meta.map((f) => ({ zipPath: `meta/${f.filename}`, r2Key: f.r2Key })),
        ...manifestFiles,
      ];
    } else if (sku === "vfx") {
      // Everything
      const allSource = [
        ...manifest.meshes.map((f) => ({ zipPath: `meshes/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.rigs.map((f) => ({ zipPath: `rig/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.dcc.map((f) => ({ zipPath: `dcc/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.exr.map((f) => ({ zipPath: `textures/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.jpeg.map((f) => ({ zipPath: `previews/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.video.map((f) => ({ zipPath: `video/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.docs.map((f) => ({ zipPath: `docs/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.raw.map((f) => ({ zipPath: `raw/${f.filename}`, r2Key: f.r2Key })),
        ...manifest.other.map((f) => ({ zipPath: `other/${f.filename}`, r2Key: f.r2Key })),
      ];
      skuFiles = [...allSource, ...manifestFiles];
    }

    if (skuFiles.length === 0) continue;

    const sizeBytes = await buildAndUploadZip(env, skuFiles, outputKey);
    outputs.push({ sku, r2Key: outputKey, filename, sizeBytes });
  }

  // Insert output records
  for (const out of outputs) {
    await db.insert(pipelineOutputs).values({
      id: crypto.randomUUID(),
      jobId,
      sku: out.sku as "preview" | "realtime" | "vfx" | "training",
      r2Key: out.r2Key,
      filename: out.filename,
      sizeBytes: out.sizeBytes,
      createdAt: now,
    });
  }

  void enc;

  await setStageStatus(db, jobId, "bundle", "complete",
    `${outputs.length} SKU bundle(s) generated: ${outputs.map((o) => o.sku).join(", ")}`,
    { outputs: outputs.map((o) => ({ sku: o.sku, sizeBytes: o.sizeBytes })) },
  );
}

async function stage5Notify(
  db: ReturnType<typeof drizzle>,
  env: Env,
  jobId: string,
  packageName: string,
  talentEmail: string,
  initiatorEmail: string,
  requestedSkus: string[],
) {
  await setStageStatus(db, jobId, "notify", "running");

  if (!env.RESEND_API_KEY) {
    await setStageStatus(db, jobId, "notify", "skipped", "RESEND_API_KEY not configured");
    return;
  }

  const jobUrl = `${env.APP_URL}/vault/pipeline/jobs/${jobId}`;
  const skuList = requestedSkus.map((s) => `• ${s}`).join("\n");

  const emailBody = {
    from: env.RESEND_FROM_EMAIL,
    to: [...new Set([talentEmail, initiatorEmail])],
    subject: `Digital Double Pipeline complete — ${packageName}`,
    text: [
      `Your digital double pipeline job has completed successfully.`,
      ``,
      `Package: ${packageName}`,
      `SKUs generated: \n${skuList}`,
      ``,
      `Download your bundles: ${jobUrl}`,
      ``,
      `— Changling`,
    ].join("\n"),
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
    await setStageStatus(db, jobId, "notify", "complete", `Email sent to ${emailBody.to.join(", ")}`);
  } catch (err) {
    await setStageStatus(db, jobId, "notify", "failed", String(err));
  }
}

// ── Main queue consumer ────────────────────────────────────────────────────

async function processJob(env: Env, jobId: string) {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);

  // Load job
  const job = await db
    .select()
    .from(pipelineJobs)
    .where(eq(pipelineJobs.id, jobId))
    .get();

  if (!job || job.status === "cancelled") return;

  // Mark processing
  await db.update(pipelineJobs)
    .set({ status: "processing", startedAt: now })
    .where(eq(pipelineJobs.id, jobId));

  // Load package name + talent email + initiator email
  const pkg = await db
    .select({ name: scanPackages.name })
    .from(scanPackages)
    .where(eq(scanPackages.id, job.packageId))
    .get();

  const talentUser = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, job.talentId))
    .get();

  const initiatorUser = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, job.initiatedBy))
    .get();

  const packageName = pkg?.name ?? "Unknown Package";
  const talentEmail = talentUser?.email ?? "";
  const initiatorEmail = initiatorUser?.email ?? "";
  const requestedSkus = JSON.parse(job.skus) as string[];
  const r2Prefix = `jobs/${jobId}`;

  // Ensure stage rows exist (insert if not already created by API route)
  const stageNames = ["validate", "classify", "assemble", "bundle", "notify"];
  for (const stage of stageNames) {
    await db.insert(pipelineStages)
      .values({ id: crypto.randomUUID(), jobId, stage, status: "pending", startedAt: null, completedAt: null })
      .onConflictDoNothing();
  }

  // Update R2 prefix on job
  await db.update(pipelineJobs)
    .set({ outputR2Prefix: r2Prefix })
    .where(eq(pipelineJobs.id, jobId));

  try {
    const manifest = await stage1Validate(db, env, jobId, job.packageId, r2Prefix);
    const textureManifest = await stage2Classify(db, env, jobId, manifest, r2Prefix);
    await stage3Assemble(db, env, jobId, job.packageId, manifest, textureManifest, r2Prefix, packageName);
    await stage4Bundle(db, env, jobId, manifest, requestedSkus, r2Prefix, packageName);
    await stage5Notify(db, env, jobId, packageName, talentEmail, initiatorEmail, requestedSkus);

    await db.update(pipelineJobs)
      .set({ status: "complete", completedAt: Math.floor(Date.now() / 1000) })
      .where(eq(pipelineJobs.id, jobId));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.update(pipelineJobs)
      .set({ status: "failed", error: errMsg, completedAt: Math.floor(Date.now() / 1000) })
      .where(eq(pipelineJobs.id, jobId));
    throw err; // re-throw so Queue retries
  }
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const body = message.body as JobMessage;
      try {
        await processJob(env, body.jobId);
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
