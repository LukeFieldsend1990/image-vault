export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getDb } from "@/lib/db";
import { scanPackages, scanFiles, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { eq, and } from "drizzle-orm";

// ── CRC-32 ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function updateCrc(crc: number, chunk: Uint8Array): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

// ── Little-endian helpers ─────────────────────────────────────────────────────

function u16le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}
function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}
function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ── ZIP structures ────────────────────────────────────────────────────────────

const SIG_LOCAL  = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const SIG_DD     = new Uint8Array([0x50, 0x4b, 0x07, 0x08]);
const SIG_CD     = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
const SIG_EOCD64 = new Uint8Array([0x50, 0x4b, 0x06, 0x06]);
const SIG_LOC64  = new Uint8Array([0x50, 0x4b, 0x06, 0x07]);
const SIG_EOCD   = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

function localFileHeader(nameBytes: Uint8Array, fileSize: bigint): Uint8Array {
  const z64 = fileSize >= 0xffffffffn;
  const extra = z64
    ? concat(u16le(0x0001), u16le(16), u64le(fileSize), u64le(fileSize))
    : new Uint8Array(0);
  const sf = z64 ? 0xffffffff : Number(fileSize);
  return concat(
    SIG_LOCAL, u16le(z64 ? 45 : 20), u16le(0x0808), u16le(0),
    u16le(0), u16le(0), u32le(0), u32le(sf), u32le(sf),
    u16le(nameBytes.length), u16le(extra.length),
    nameBytes, extra,
  );
}

function dataDescriptor(crc32: number, size: bigint): Uint8Array {
  if (size >= 0xffffffffn) return concat(SIG_DD, u32le(crc32), u64le(size), u64le(size));
  return concat(SIG_DD, u32le(crc32), u32le(Number(size)), u32le(Number(size)));
}

interface CdEntry { nameBytes: Uint8Array; crc32: number; fileSize: bigint; localOffset: bigint; }

function centralDirRecord(e: CdEntry): Uint8Array {
  const zs = e.fileSize >= 0xffffffffn, zo = e.localOffset >= 0xffffffffn;
  const z64 = zs || zo;
  const extraParts: Uint8Array[] = [];
  if (zs) { extraParts.push(u64le(e.fileSize)); extraParts.push(u64le(e.fileSize)); }
  if (zo) extraParts.push(u64le(e.localOffset));
  const extra = z64
    ? concat(u16le(0x0001), u16le(extraParts.reduce((s, p) => s + p.length, 0)), ...extraParts)
    : new Uint8Array(0);
  return concat(
    SIG_CD, u16le(z64 ? 45 : 20), u16le(z64 ? 45 : 20),
    u16le(0), u16le(0), u16le(0), u16le(0), u32le(e.crc32),
    u32le(zs ? 0xffffffff : Number(e.fileSize)),
    u32le(zs ? 0xffffffff : Number(e.fileSize)),
    u16le(e.nameBytes.length), u16le(extra.length),
    u16le(0), u16le(0), u16le(0), u32le(0),
    u32le(zo ? 0xffffffff : Number(e.localOffset)),
    e.nameBytes, extra,
  );
}

function endOfCentralDir(entries: CdEntry[], cdOffset: bigint, cdSize: bigint): Uint8Array {
  const count = entries.length;
  const z64 = cdOffset >= 0xffffffffn || cdSize >= 0xffffffffn || count > 0xffff;
  if (!z64) {
    return concat(
      SIG_EOCD, u16le(0), u16le(0), u16le(count), u16le(count),
      u32le(Number(cdSize)), u32le(Number(cdOffset)), u16le(0),
    );
  }
  return concat(
    SIG_EOCD64, u64le(44n), u16le(45), u16le(45),
    u32le(0), u32le(0), u64le(BigInt(count)), u64le(BigInt(count)),
    u64le(cdSize), u64le(cdOffset),
    SIG_LOC64, u32le(0), u64le(cdOffset + cdSize), u32le(1),
    SIG_EOCD, u16le(0), u16le(0),
    u16le(Math.min(count, 0xffff)), u16le(Math.min(count, 0xffff)),
    u32le(0xffffffff), u32le(0xffffffff), u16le(0),
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

// GET /api/vault/packages/[packageId]/bundle?name=package.zip
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const pkg = await db.select().from(scanPackages).where(eq(scanPackages.id, packageId)).get();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  const isOwner = pkg.talentId === session.sub;
  const isRep = session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId));
  if (!isOwner && !isRep) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const files = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename, r2Key: scanFiles.r2Key, sizeBytes: scanFiles.sizeBytes })
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
    .all();

  if (files.length === 0) {
    return NextResponse.json({ error: "No completed files in this package" }, { status: 404 });
  }

  const bundleName = (new URL(req.url).searchParams.get("name") ?? `${pkg.name}.zip`).replace(/[^\w. -]/g, "_");
  const now = Math.floor(Date.now() / 1000);
  // Extract before async closure — TypeScript type narrowing doesn't cross function boundaries
  const userId = session.sub;
  const userIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const accountId = process.env.CF_ACCOUNT_ID!;
  const bucketName = process.env.R2_BUCKET_NAME ?? "image-vault-scans";
  const r2 = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    region: "auto",
    service: "s3",
  });

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  async function buildZip() {
    let offset = 0n;
    const cdEntries: CdEntry[] = [];

    for (const file of files) {
      const objectUrl = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${file.r2Key}`;
      const signedReq = await r2.sign(new Request(objectUrl, { method: "GET" }));
      const r2Res = await fetch(signedReq);
      if (!r2Res.ok || !r2Res.body) continue; // skip missing objects

      const nameBytes = enc.encode(file.filename);
      const fileSize = BigInt(file.sizeBytes);
      const localOffset = offset;

      const lfh = localFileHeader(nameBytes, fileSize);
      await writer.write(lfh);
      offset += BigInt(lfh.length);

      let crc = 0;
      const reader = r2Res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        crc = updateCrc(crc, value);
        await writer.write(value);
        offset += BigInt(value.length);
      }

      const dd = dataDescriptor(crc, fileSize);
      await writer.write(dd);
      offset += BigInt(dd.length);

      cdEntries.push({ nameBytes, crc32: crc, fileSize, localOffset });
    }

    // Log download events
    void Promise.all(
      files.map((f) =>
        db.insert(downloadEvents).values({
          id: crypto.randomUUID(),
          licenceId: null,
          licenseeId: userId,
          fileId: f.id,
          startedAt: now,
          completedAt: now,
          bytesTransferred: f.sizeBytes,
          ip: userIp,
          userAgent: userAgent,
        })
      )
    );

    // Central directory
    const cdOffset = offset;
    let cdSize = 0n;
    for (const e of cdEntries) {
      const rec = centralDirRecord(e);
      await writer.write(rec);
      cdSize += BigInt(rec.length);
    }

    const eocd = endOfCentralDir(cdEntries, cdOffset, cdSize);
    await writer.write(eocd);
    await writer.close();
  }

  void buildZip();

  return new NextResponse(readable as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bundleName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
