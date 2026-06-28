// Short-lived, HMAC-signed tokens that authorise fetching a single R2 object
// through the gated image proxy (GET /api/pitch/image). The token carries the
// R2 key + expiry and is signed with a secret shared between the main app and
// the higgs-worker, so the proxy can trust the key without a DB lookup and the
// URL can be neither forged nor repointed at another object.

const enc = new TextEncoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlFromString = (s: string): string => b64urlFromBytes(enc.encode(s));
const stringFromB64url = (s: string): string => new TextDecoder().decode(bytesFromB64url(s));

function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

/**
 * Mint a token for `r2Key`, valid for `ttlSecs` from now.
 * Format: <base64url(r2Key)>.<exp>.<base64url(sig)> — all URL-safe, no dots
 * inside the parts so it splits cleanly.
 */
export async function signImageToken(secret: string, r2Key: string, ttlSecs: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSecs;
  const data = `${r2Key}:${exp}`;
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${b64urlFromString(r2Key)}.${exp}.${b64urlFromBytes(sig)}`;
}

/**
 * Verify a token. Returns the embedded `r2Key` if the signature is valid and the
 * token hasn't expired, otherwise null. Signature comparison is constant-time
 * (crypto.subtle.verify).
 */
export async function verifyImageToken(
  secret: string,
  token: string,
  nowSecs: number = Math.floor(Date.now() / 1000)
): Promise<{ r2Key: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encKey, expStr, encSig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < nowSecs) return null;

  let r2Key: string;
  let sig: Uint8Array;
  try {
    r2Key = stringFromB64url(encKey);
    sig = bytesFromB64url(encSig);
  } catch {
    return null;
  }

  const key = await hmacKey(secret, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, sig.buffer as ArrayBuffer, enc.encode(`${r2Key}:${exp}`));
  return ok ? { r2Key } : null;
}
