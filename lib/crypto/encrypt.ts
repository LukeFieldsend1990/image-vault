/**
 * Encryption stub — Phase 2.5 will replace this with AES-256-GCM
 * using the talent's vault KEK derived from their passphrase.
 */
export async function encryptChunk(chunk: ArrayBuffer): Promise<ArrayBuffer> {
  // TODO Phase 2.5: AES-256-GCM with vault KEK
  return chunk;
}
