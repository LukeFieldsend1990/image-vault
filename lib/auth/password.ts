const ITERATIONS = 310_000;
const KEY_LEN = 32; // bytes

function hexEncode(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LEN * 8
  );
  return `pbkdf2:v1:${ITERATIONS}:${hexEncode(salt.buffer)}:${hexEncode(derived)}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "v1") {
    return false;
  }
  const iterations = parseInt(parts[2], 10);
  const salt = hexDecode(parts[3]);
  const expectedHash = hexDecode(parts[4]);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LEN * 8
  );
  const derivedBytes = new Uint8Array(derived);

  // Constant-time compare
  if (derivedBytes.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedBytes.length; i++) {
    diff |= derivedBytes[i] ^ expectedHash[i];
  }
  return diff === 0;
}

/** Run a dummy PBKDF2 to prevent timing-based user enumeration */
export async function dummyPasswordCheck(): Promise<void> {
  await verifyPassword("dummy", "pbkdf2:v1:310000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000");
}
