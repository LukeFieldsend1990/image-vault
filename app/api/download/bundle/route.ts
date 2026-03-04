export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, scanFiles, downloadEvents } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { eq, inArray } from "drizzle-orm";

const MAX_TOKENS = 100;

interface DownloadToken {
  licenceId: string;
  fileId: string;
  licenseeId: string;
  expiresAt: number;
}

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
  return new Uint8Array([(n & 0xff), (n >> 8) & 0xff]);
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

// Local file header. We set bit 3 (data descriptor) and put real size in ZIP64
// extra field. crc32/compressed/uncompressed fields in LFH are 0 (data
// descriptor follows the file data).
function localFileHeader(nameBytes: Uint8Array, fileSize: bigint): Uint8Array {
  const needsZip64 = fileSize >= 0xffffffffn;
  const zip64Extra = needsZip64
    ? concat(u16le(0x0001), u16le(16), u64le(fileSize), u64le(fileSize))
    : new Uint8Array(0);
  const extraLen = zip64Extra.length;
  const sizeField = needsZip64 ? 0xffffffff : Number(fileSize);

  return concat(
    SIG_LOCAL,
    u16le(needsZip64 ? 45 : 20),   // version needed
    u16le(0x0808),                   // general purpose bit flag: UTF-8 + data descriptor
    u16le(0),                        // compression: STORE
    u16le(0), u16le(0),             // last mod time/date (zeroed)
    u32le(0),                        // crc-32 (in data descriptor)
    u32le(sizeField),                // compressed size
    u32le(sizeField),                // uncompressed size
    u16le(nameBytes.length),
    u16le(extraLen),
    nameBytes,
    zip64Extra,
  );
}

// Data descriptor (written after file data)
function dataDescriptor(crc32: number, fileSize: bigint): Uint8Array {
  const needsZip64 = fileSize >= 0xffffffffn;
  if (needsZip64) {
    return concat(SIG_DD, u32le(crc32), u64le(fileSize), u64le(fileSize));
  }
  return concat(SIG_DD, u32le(crc32), u32le(Number(fileSize)), u32le(Number(fileSize)));
}

interface CdEntry {
  nameBytes: Uint8Array;
  crc32: number;
  fileSize: bigint;
  localOffset: bigint;
}

// Central directory record for one entry
function centralDirRecord(e: CdEntry): Uint8Array {
  const needsZip64 = e.fileSize >= 0xffffffffn || e.localOffset >= 0xffffffffn;
  const zip64Parts: Uint8Array[] = [];
  if (needsZip64) {
    zip64Parts.push(u64le(e.fileSize));   // uncompressed
    zip64Parts.push(u64le(e.fileSize));   // compressed
    zip64Parts.push(u64le(e.localOffset));
  }
  const zip64Extra = needsZip64
    ? concat(u16le(0x0001), u16le(zip64Parts.reduce((s, p) => s + p.length, 0)), ...zip64Parts)
    : new Uint8Array(0);

  return concat(
    SIG_CD,
    u16le(needsZip64 ? 45 : 20),   // version made by
    u16le(needsZip64 ? 45 : 20),   // version needed
    u16le(0),                        // general purpose bit flag
    u16le(0),                        // compression: STORE
    u16le(0), u16le(0),             // last mod time/date
    u32le(e.crc32),
    u32le(needsZip64 ? 0xffffffff : Number(e.fileSize)),  // compressed
    u32le(needsZip64 ? 0xffffffff : Number(e.fileSize)),  // uncompressed
    u16le(e.nameBytes.length),
    u16le(zip64Extra.length),
    u16le(0),                        // file comment length
    u16le(0),                        // disk number start
    u16le(0),                        // internal attrs
    u32le(0),                        // external attrs
    u32le(needsZip64 ? 0xffffffff : Number(e.localOffset)),
    e.nameBytes,
    zip64Extra,
  );
}

// End of central directory (ZIP64 + standard)
function endOfCentralDir(
  entries: CdEntry[],
  cdOffset: bigint,
  cdSize: bigint,
): Uint8Array {
  const count = entries.length;
  const needsZip64 = cdOffset >= 0xffffffffn || cdSize >= 0xffffffffn || count > 0xffff;
  const eocd64Offset = cdOffset + cdSize;

  if (!needsZip64) {
    return concat(
      SIG_EOCD,
      u16le(0), u16le(0),           // disk number, disk with CD start
      u16le(count), u16le(count),   // entries this disk, total entries
      u32le(Number(cdSize)),
      u32le(Number(cdOffset)),
      u16le(0),                      // comment length
    );
  }

  // ZIP64 EOCD record
  const eocd64 = concat(
    SIG_EOCD64,
    u64le(44n),                      // size of ZIP64 EOCD record (after this field)
    u16le(45), u16le(45),           // version made by, version needed
    u32le(0), u32le(0),             // disk number, disk with CD start
    u64le(BigInt(count)), u64le(BigInt(count)),
    u64le(cdSize),
    u64le(cdOffset),
  );

  // ZIP64 EOCD locator
  const loc64 = concat(
    SIG_LOC64,
    u32le(0),                        // disk with ZIP64 EOCD
    u64le(eocd64Offset),
    u32le(1),                        // total disks
  );

  // Standard EOCD (with 0xffff/0xffffffff sentinels for ZIP64)
  const eocd = concat(
    SIG_EOCD,
    u16le(0), u16le(0),
    u16le(Math.min(count, 0xffff)), u16le(Math.min(count, 0xffff)),
    u32le(0xffffffff),
    u32le(0xffffffff),
    u16le(0),
  );

  return concat(eocd64, loc64, eocd);
}

// ── Route handler ─────────────────────────────────────────────────────────────

// GET /api/download/bundle?tokens=t1,t2,...&name=bundle.zip
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { searchParams } = new URL(req.url);
  const rawTokens = searchParams.get("tokens") ?? "";
  const bundleName = searchParams.get("name") ?? "bundle.zip";

  const tokenIds = rawTokens
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TOKENS);

  if (tokenIds.length === 0) {
    return NextResponse.json({ error: "No tokens provided" }, { status: 400 });
  }

  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  // Validate all tokens
  const tokenDataList: (DownloadToken & { tokenId: string })[] = [];
  for (const tokenId of tokenIds) {
    const td = await kv.get(`dl_token:${tokenId}`, "json") as DownloadToken | null;
    if (!td) continue; // skip missing/expired
    if (td.expiresAt < now) continue;
    if (td.licenseeId !== session.sub) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    tokenDataList.push({ ...td, tokenId });
  }

  if (tokenDataList.length === 0) {
    return NextResponse.json({ error: "No valid tokens" }, { status: 404 });
  }

  // All tokens must share the same licenceId
  const licenceIds = Array.from(new Set(tokenDataList.map((t) => t.licenceId)));
  if (licenceIds.length > 1) {
    return NextResponse.json({ error: "Tokens must belong to the same licence" }, { status: 400 });
  }

  const db = getDb();

  // Confirm licence not revoked
  const [licence] = await db
    .select({ status: licences.status })
    .from(licences)
    .where(eq(licences.id, licenceIds[0]))
    .limit(1)
    .all();

  if (!licence || licence.status === "REVOKED") {
    return NextResponse.json({ error: "Licence has been revoked" }, { status: 410 });
  }

  // Fetch all file metadata
  const fileIds = tokenDataList.map((t) => t.fileId);
  const fileRows = await db
    .select({ id: scanFiles.id, filename: scanFiles.filename, r2Key: scanFiles.r2Key, sizeBytes: scanFiles.sizeBytes })
    .from(scanFiles)
    .where(inArray(scanFiles.id, fileIds))
    .all();

  const fileMap = new Map(fileRows.map((f) => [f.id, f]));

  // Mark download events as completed (fire-and-forget; don't block stream)
  void db
    .update(downloadEvents)
    .set({ completedAt: now })
    .where(inArray(downloadEvents.fileId, fileIds));

  const { env } = getRequestContext();
  const enc = new TextEncoder();

  // Build streaming ZIP
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  async function buildZip() {
    let offset = 0n;
    const cdEntries: CdEntry[] = [];

    for (const td of tokenDataList) {
      const fileMeta = fileMap.get(td.fileId);
      if (!fileMeta) continue;

      const object = await env.SCANS_BUCKET.get(fileMeta.r2Key);
      if (!object || !object.body) continue; // skip missing R2 objects

      const nameBytes = enc.encode(fileMeta.filename);
      const fileSize = BigInt(fileMeta.sizeBytes);
      const localOffset = offset;

      const lfh = localFileHeader(nameBytes, fileSize);
      await writer.write(lfh);
      offset += BigInt(lfh.length);

      // Stream file data, computing CRC chunk by chunk
      let crc = 0;
      const reader = object.body.getReader();
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

    // Central directory
    const cdOffset = offset;
    let cdSize = 0n;
    for (const entry of cdEntries) {
      const rec = centralDirRecord(entry);
      await writer.write(rec);
      cdSize += BigInt(rec.length);
    }

    // End of central directory
    const eocd = endOfCentralDir(cdEntries, cdOffset, cdSize);
    await writer.write(eocd);

    await writer.close();
  }

  void buildZip();

  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${bundleName}"`);
  headers.set("Cache-Control", "no-store");

  return new NextResponse(readable as unknown as BodyInit, { headers });
}
