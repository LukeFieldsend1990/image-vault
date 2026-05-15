export interface FingerprintParams {
  licenceId: string;
  licenseeId: string;
  packageId: string;
  fileId: string;
}

function canonicalJson(params: FingerprintParams): string {
  return JSON.stringify({
    fileId: params.fileId,
    licenceId: params.licenceId,
    licenseeId: params.licenseeId,
    packageId: params.packageId,
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface FingerprintBits {
  bits: boolean[];
  bitsHex: string;
  payloadHash: string;
  hmacBytes: Uint8Array;
}

export async function generateFingerprintBits(
  params: FingerprintParams,
  secret: string,
  bitLength = 128,
): Promise<FingerprintBits> {
  const payload = canonicalJson(params);
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
  for (let i = 0; i < bitLength; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    bits.push(((hmacBytes[byteIdx] >> bitIdx) & 1) === 1);
  }

  const bitsHex = Array.from(hmacBytes.slice(0, Math.ceil(bitLength / 8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { bits, bitsHex, payloadHash, hmacBytes };
}

export function bitsFromHex(hex: string, bitLength = 128): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < bitLength; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8);
    const byte = parseInt(hex.slice(byteIdx * 2, byteIdx * 2 + 2), 16);
    bits.push(((byte >> bitIdx) & 1) === 1);
  }
  return bits;
}

function makeXorshift32(seed: number) {
  let s = (seed >>> 0) || 0x12345678;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export function selectVertices(
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
