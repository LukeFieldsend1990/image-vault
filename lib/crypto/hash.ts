/**
 * SHA-256 helpers.
 *
 * `sha256HexFromStream` computes the digest of a (potentially large) byte
 * stream without buffering the whole thing in memory, using the Cloudflare
 * Workers `crypto.DigestStream` extension. Outside the Workers runtime (e.g.
 * Node during tests) it falls back to buffering the stream then hashing via the
 * standard Web Crypto `subtle.digest`.
 */

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface DigestStreamLike extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
}

type DigestStreamCtor = new (algorithm: string) => DigestStreamLike;

export async function sha256HexFromStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const ctor = (crypto as unknown as { DigestStream?: DigestStreamCtor })
    .DigestStream;

  if (typeof ctor === "function") {
    const digestStream = new ctor("SHA-256");
    await stream.pipeTo(digestStream);
    return toHex(await digestStream.digest);
  }

  // Fallback (Node / tests): buffer then digest.
  const buf = await new Response(stream).arrayBuffer();
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}
