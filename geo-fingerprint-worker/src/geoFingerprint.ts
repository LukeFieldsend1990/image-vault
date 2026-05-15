// Standalone geo-fingerprint implementation for the worker (no app imports)

// ── OBJ Parser ────────────────────────────────────────────────────────────────

interface ParsedObj {
  vertices: Float64Array[];
  vertexLineIndices: number[];
  lines: string[];
  faces: number[][];
}

function parseObj(text: string): ParsedObj {
  const lines = text.split("\n");
  const vertices: Float64Array[] = [];
  const vertexLineIndices: number[] = [];
  const faces: number[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("v ") || line.startsWith("v\t")) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        vertices.push(new Float64Array([x, y, z]));
        vertexLineIndices.push(i);
      }
    } else if (line.startsWith("f ") || line.startsWith("f\t")) {
      const parts = line.split(/\s+/).slice(1);
      const faceVerts: number[] = [];
      for (const part of parts) {
        const idx = parseInt(part.split("/")[0]) - 1;
        if (!isNaN(idx) && idx >= 0) faceVerts.push(idx);
      }
      if (faceVerts.length >= 3) faces.push(faceVerts);
    }
  }

  return { vertices, vertexLineIndices, lines, faces };
}

function computeBboxDiagonal(vertices: Float64Array[]): number {
  if (vertices.length === 0) return 1;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
}

function estimateNormals(vertices: Float64Array[], faces: number[][]): Float64Array[] {
  const normals = vertices.map(() => new Float64Array(3));
  for (const face of faces) {
    for (let tri = 0; tri < face.length - 2; tri++) {
      const ai = face[0], bi = face[tri + 1], ci = face[tri + 2];
      if (ai >= vertices.length || bi >= vertices.length || ci >= vertices.length) continue;
      const a = vertices[ai], b = vertices[bi], c = vertices[ci];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      normals[ai][0] += nx; normals[ai][1] += ny; normals[ai][2] += nz;
      normals[bi][0] += nx; normals[bi][1] += ny; normals[bi][2] += nz;
      normals[ci][0] += nx; normals[ci][1] += ny; normals[ci][2] += nz;
    }
  }
  for (const n of normals) {
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 0) { n[0] /= len; n[1] /= len; n[2] /= len; } else { n[1] = 1; }
  }
  return normals;
}

function serializeObj(parsed: ParsedObj, modified: Float64Array[]): string {
  const lines = [...parsed.lines];
  for (let i = 0; i < modified.length; i++) {
    const v = modified[i];
    lines[parsed.vertexLineIndices[i]] =
      `v ${v[0].toFixed(8)} ${v[1].toFixed(8)} ${v[2].toFixed(8)}`;
  }
  return lines.join("\n");
}

// ── Payload / HMAC ────────────────────────────────────────────────────────────

interface FingerprintParams {
  licenceId: string;
  licenseeId: string;
  packageId: string;
  fileId: string;
}

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

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Embed ────────────────────────────────────────────────────────────────────

const BIT_LENGTH = 128;
const REPEAT_FACTOR = 5;
const SLOT_COUNT = BIT_LENGTH * REPEAT_FACTOR;

export interface EmbedResult {
  watermarkedObjText: string;
  fingerprintBitsHex: string;
  payloadHash: string;
  regionCount: number;
  vertexCount: number;
  faceCount: number;
  maxDisplacement: number;
}

export async function embedFingerprint(
  objText: string,
  params: FingerprintParams,
  secret: string,
  strength = 0.00001,
): Promise<EmbedResult> {
  const parsed = parseObj(objText);
  const { vertices, faces } = parsed;

  if (vertices.length < 10) throw new Error("OBJ has too few vertices for fingerprinting");

  const diagonal = computeBboxDiagonal(vertices);
  const normals = estimateNormals(vertices, faces);

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

  const expandedBits = Array.from({ length: SLOT_COUNT }, (_, i) => bits[Math.floor(i / REPEAT_FACTOR)]);
  const selectedVertices = selectVertices(hmacBytes, params.fileId, vertices.length, SLOT_COUNT);

  const modified = vertices.map((v) => new Float64Array(v));
  const offsetAmount = strength * diagonal;

  for (let i = 0; i < SLOT_COUNT; i++) {
    const vi = selectedVertices[i];
    const sign = expandedBits[i] ? 1.0 : -1.0;
    const n = normals[vi];
    modified[vi][0] += sign * n[0] * offsetAmount;
    modified[vi][1] += sign * n[1] * offsetAmount;
    modified[vi][2] += sign * n[2] * offsetAmount;
  }

  return {
    watermarkedObjText: serializeObj(parsed, modified),
    fingerprintBitsHex: bitsHex,
    payloadHash,
    regionCount: new Set(selectedVertices).size,
    vertexCount: vertices.length,
    faceCount: faces.length,
    maxDisplacement: offsetAmount,
  };
}
