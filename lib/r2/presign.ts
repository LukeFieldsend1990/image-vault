// Presigned R2 GET URLs — short-lived, signed, publicly fetchable links to
// private R2 objects. Used to hand source images to external services (e.g.
// Higgsfield) that pull by URL, without exposing the bucket or our session auth.
//
// Credentials are passed explicitly so this works from any Worker (the main app
// and the standalone higgs-worker) rather than reaching into a request context.

import { AwsClient } from "aws4fetch";

export interface R2PresignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

/**
 * Returns the presign config from a flat env bag, or null if any required
 * credential is missing (so callers can degrade gracefully).
 */
export function r2PresignConfigFromEnv(
  env: Record<string, string | undefined>,
  bucketFallback = "image-vault-scans"
): R2PresignConfig | null {
  const accountId = env.CF_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName: env.R2_BUCKET_NAME ?? bucketFallback,
  };
}

/**
 * Generate a presigned R2 GET URL valid for `ttlSecs` seconds. The returned
 * URL needs no further auth — anyone (or anything) with the link can GET the
 * object until it expires.
 */
export async function presignR2GetUrl(
  cfg: R2PresignConfig,
  r2Key: string,
  ttlSecs: number
): Promise<string> {
  const r2 = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
  });
  // The URL constructor percent-encodes the path; aws4fetch signs the same
  // canonical pathname, so keys with spaces/slashes stay consistent.
  const url = new URL(
    `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucketName}/${r2Key}`
  );
  url.searchParams.set("X-Amz-Expires", String(ttlSecs));
  const signed = await r2.sign(new Request(url.toString(), { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}
