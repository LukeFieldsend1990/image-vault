/**
 * Generates a P-256 ECDSA key pair for the CAS Bridge manifest signing.
 *
 * Run once:
 *   node scripts/generate-bridge-key.mjs
 *
 * Then set the private key as a Wrangler secret:
 *   npx wrangler secret put BRIDGE_SIGNING_KEY_JWK
 *   (paste the private JWK printed below)
 *
 * Store the public JWK separately — the CAS Bridge desktop app needs it to
 * verify manifest signatures offline.
 */

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);

console.log("\n── PRIVATE KEY JWK (set as BRIDGE_SIGNING_KEY_JWK secret) ──────────────");
console.log(JSON.stringify(privateJwk));

console.log("\n── PUBLIC KEY JWK (embed in CAS Bridge desktop app) ────────────────────");
console.log(JSON.stringify(publicJwk));

console.log("\n── Setup ────────────────────────────────────────────────────────────────");
console.log("1. Copy the private JWK above and run:");
console.log("     npx wrangler secret put BRIDGE_SIGNING_KEY_JWK");
console.log("2. Paste the public JWK into the CAS Bridge app config.");
console.log("   Key ID: bridge-signing-key-1\n");
