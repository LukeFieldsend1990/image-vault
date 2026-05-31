// Standalone geo-fingerprint implementation for the worker (no app imports)
//
// Uses two-pass streaming R2 reads to handle arbitrarily large OBJ files
// without hitting the 128MB Worker memory limit:
//   Pass 1 — stream to count vertices + compute bbox diagonal (O(1) extra memory)
//   Pass 2 — stream to apply modifications line-by-line, piped directly into R2 put
//
// Normal estimation (which requires loading all faces) is replaced by a
// deterministic HMAC-derived direction per slot — same robustness, zero topology cost.

const BIT_LENGTH = 128;
const REPEAT_FACTOR = 5;
const SLOT_COUNT = BIT_LENGTH * REPEAT_FACTOR; // 640

export interface FingerprintParams {
  licenceId: string;
  licenseeId: string;
  packageId: string;
  fileId: string;
}

export interface EmbedResult {
  outputStream: ReadableStream<Uint8Array>;
  fingerprintBitsHex: string;
  payloadHash: string;
  regionCount: number;
  vertexCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeXorshift32(seed: number) {
  let s = (seed >>> 0) || 0x12345678;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function selectVertices(
  hmacBytes: Uint8Array,
  fileId: string,
  vertexCount: number,
  slotCount: number,
): number[] {
  let fileHash = 0;
  for (let i = 0; i < fileId.length; i++) {
    fileHash = (Math.imul(fileHash, 31) + fileId.charCodeAt(i)) | 0;
  }
  const hmacSeed =
    ((hmacBytes[0] << 24) | (hmacBytes[1] << 16) | (hmacBytes[2] << 8) | hmacBytes[3]) >>> 0;
  const seed = (hmacSeed ^ (fileHash >>> 0)) >>> 0;
  const rng = makeXorshift32(seed);
  return Array.from({ length: slotCount }, () => Math.floor(rng() * vertexCount));
}

// Deterministic unit direction for slot i, derived from the first 16 hmacBytes.
// Uses indices mod 16 so only the 128-bit fingerprint payload stored in the DB is needed.
export function slotDirection(hmacBytes: Uint8Array, slot: number): [number, number, number] {
  const i0 = (slot * 7) % 16;
  const i1 = (slot * 7 + 1) % 16;
  const i2 = (slot * 7 + 2) % 16;
  const a = ((hmacBytes[i0] ^ (slot >> 2)) & 0xff) / 255;
  const b = ((hmacBytes[i1] ^ (slot & 0xff)) & 0xff) / 255;
  const c = ((hmacBytes[i2] ^ ((slot * 3) & 0xff)) & 0xff) / 255;
  const x = a * 2 - 1, y = b * 2 - 1, z = c * 2 - 1;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / len, y / len, z / len];
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Pass 1: stream to get vertex count + bbox diagonal ────────────────────────

async function streamCountAndBbox(
  stream: ReadableStream<Uint8Array>,
): Promise<{ vertexCount: number; diagonal: number }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let vertexCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const processLine = (line: string) => {
    const t = line.trimStart();
    if (!t.startsWith("v ") && !t.startsWith("v\t")) return;
    const parts = t.split(/\s+/);
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return;
    vertexCount++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };

  while (true) {
    const { done, value } = await reader.read();
    const chunk = decoder.decode(value, { stream: !done });
    const text = remainder + chunk;
    if (done) {
      if (text) processLine(text);
      break;
    }
    const lastNl = text.lastIndexOf("\n");
    if (lastNl === -1) { remainder = text; continue; }
    const lines = text.slice(0, lastNl).split("\n");
    remainder = text.slice(lastNl + 1);
    for (const line of lines) processLine(line);
  }

  if (vertexCount === 0) throw new Error("OBJ has no vertices");
  if (vertexCount < 10) throw new Error("OBJ has too few vertices for fingerprinting");

  const dx = (maxX - minX) || 1;
  const dy = (maxY - minY) || 1;
  const dz = (maxZ - minZ) || 1;
  return { vertexCount, diagonal: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

// ── Compute per-vertex delta map (compact; only selected vertices) ─────────────

interface ModMap {
  mods: Map<number, [number, number, number]>; // vertexIdx → [dx, dy, dz]
  bitsHex: string;
  payloadHash: string;
  regionCount: number;
}

async function computeModifications(
  params: FingerprintParams,
  secret: string,
  vertexCount: number,
  diagonal: number,
  strength: number,
): Promise<ModMap> {
  const payload = JSON.stringify({
    fileId: params.fileId,
    licenceId: params.licenceId,
    licenseeId: params.licenseeId,
    packageId: params.packageId,
  });
  const payloadHash = await sha256Hex(payload);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hmacBytes = new Uint8Array(sig);

  const bits: boolean[] = [];
  for (let i = 0; i < BIT_LENGTH; i++) {
    bits.push(((hmacBytes[Math.floor(i / 8)] >> (7 - (i % 8))) & 1) === 1);
  }
  const bitsHex = Array.from(hmacBytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expandedBits = Array.from(
    { length: SLOT_COUNT },
    (_, i) => bits[Math.floor(i / REPEAT_FACTOR)],
  );
  const selectedVertices = selectVertices(hmacBytes, params.fileId, vertexCount, SLOT_COUNT);
  const offsetAmount = strength * diagonal;

  const mods = new Map<number, [number, number, number]>();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const vi = selectedVertices[i];
    const sign = expandedBits[i] ? 1 : -1;
    const [nx, ny, nz] = slotDirection(hmacBytes, i);
    const existing = mods.get(vi);
    if (existing) {
      existing[0] += sign * nx * offsetAmount;
      existing[1] += sign * ny * offsetAmount;
      existing[2] += sign * nz * offsetAmount;
    } else {
      mods.set(vi, [sign * nx * offsetAmount, sign * ny * offsetAmount, sign * nz * offsetAmount]);
    }
  }

  return { mods, bitsHex, payloadHash, regionCount: mods.size };
}

// ── Pass 2: stream-apply modifications → ReadableStream ───────────────────────

function streamApplyModifications(
  inputStream: ReadableStream<Uint8Array>,
  mods: Map<number, [number, number, number]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const reader = inputStream.getReader();
    const decoder = new TextDecoder();
    let remainder = "";
    let vertexIdx = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        const input = remainder + decoder.decode(value, { stream: !done });

        let lines: string[];
        let newRemainder: string;

        if (done) {
          lines = input ? [input] : [];
          newRemainder = "";
        } else {
          const lastNl = input.lastIndexOf("\n");
          if (lastNl === -1) { remainder = input; continue; }
          lines = input.slice(0, lastNl).split("\n");
          newRemainder = input.slice(lastNl + 1);
        }

        let chunk = "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const t = line.trimStart();
          const isVertex = t.startsWith("v ") || t.startsWith("v\t");

          if (isVertex) {
            const mod = mods.get(vertexIdx);
            if (mod) {
              const parts = t.split(/\s+/);
              const x = parseFloat(parts[1]) + mod[0];
              const y = parseFloat(parts[2]) + mod[1];
              const z = parseFloat(parts[3]) + mod[2];
              chunk += `v ${x.toFixed(8)} ${y.toFixed(8)} ${z.toFixed(8)}`;
            } else {
              chunk += line;
            }
            vertexIdx++;
          } else {
            chunk += line;
          }
          if (!done || i < lines.length - 1) chunk += "\n";
        }

        if (chunk) await writer.write(encoder.encode(chunk));
        remainder = newRemainder;
        if (done) break;
      }
      await writer.close();
    } catch (err) {
      await writer.abort(err instanceof Error ? err : new Error(String(err)));
    }
  })().catch(() => {});

  return readable;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FingerprintMods {
  mods: Map<number, [number, number, number]>;
  fingerprintBitsHex: string;
  payloadHash: string;
  regionCount: number;
  vertexCount: number;
}

// Pure HMAC computation — no R2 access. Caller supplies vertexCount + diagonal
// (obtained via range-based reading in index.ts to avoid loading the full file).
export async function buildFingerprintMods(
  vertexCount: number,
  diagonal: number,
  params: FingerprintParams,
  secret: string,
  strength = 0.00001,
): Promise<FingerprintMods> {
  if (vertexCount < 10) throw new Error("OBJ has too few vertices for fingerprinting");
  const { mods, bitsHex, payloadHash, regionCount } = await computeModifications(
    params, secret, vertexCount, diagonal, strength,
  );
  return { mods, fingerprintBitsHex: bitsHex, payloadHash, regionCount, vertexCount };
}
