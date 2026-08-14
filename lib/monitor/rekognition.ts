/**
 * AWS Rekognition CompareFaces as an alternate identity-check provider.
 *
 * Rekognition returns a real cosine similarity between two faces (0-100),
 * not a three-bucket text answer, so switching to it lifts the confidence
 * ceiling from ~90% (LLaVA cap) to the actual measured similarity — which
 * on a genuine face match runs 95-99. It also does face detection
 * internally, so we don't need the LLaVA face-presence pre-check on this
 * path (no face → UnmatchedFaces, we treat as denied).
 *
 * Cost: ~$0.001 per image processed. Two images per call = $0.002. A
 * 60-candidate sweep is ~$0.12 vs $0 for LLaVA (Workers AI is free), so
 * the setting defaults to LLaVA and the operator flips only when they
 * want the accuracy trade-off.
 *
 * Signing: aws4fetch is already a project dep (used by R2 presigned URL
 * signing), so we reuse it rather than importing @aws-sdk which would
 * blow the Workers bundle size out.
 */

import { AwsClient } from "aws4fetch";

export interface RekognitionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Defaults to us-east-1; a US-region endpoint is cheapest for us. */
  region?: string;
}

export interface CompareFacesResult {
  /** Similarity in 0-1 range (Rekognition returns 0-100, we normalise). */
  similarity: number;
  /** Number of matching faces (>=1 = match). */
  matches: number;
  /** Number of unmatched faces in the target — useful signal for group shots. */
  unmatched: number;
}

/**
 * Base64-encode a Uint8Array without relying on Buffer (unavailable on the
 * Workers runtime). Chunked to avoid the "Maximum call stack size exceeded"
 * on large images.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Compare a target image (candidate thumbnail) against a source image
 * (talent's reference photo). Returns null on any error or when the
 * source has no detectable face — refusing to hallucinate a signal is
 * more useful than pretending.
 *
 * SimilarityThreshold on the API is the FaceMatch cutoff; anything below
 * lands in UnmatchedFaces. We ask for a low threshold (60) so we see the
 * borderline cases and can bucket them ourselves — the caller's threshold
 * is what actually decides "confirmed" vs "denied".
 */
export async function compareFaces(
  creds: RekognitionCredentials,
  sourceBytes: Uint8Array,
  targetBytes: Uint8Array
): Promise<CompareFacesResult | null> {
  const region = creds.region ?? "us-east-1";
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: "rekognition",
    region,
  });

  const body = {
    SourceImage: { Bytes: toBase64(sourceBytes) },
    TargetImage: { Bytes: toBase64(targetBytes) },
    SimilarityThreshold: 60,
  };

  try {
    const res = await client.fetch(`https://rekognition.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "RekognitionService.CompareFaces",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 400 InvalidParameterException happens when the source has no face,
      // which is a data condition not a code bug — logging every one would
      // drown real errors. Callers see the null return.
      return null;
    }
    const data = (await res.json()) as {
      FaceMatches?: Array<{ Similarity?: number }>;
      UnmatchedFaces?: Array<unknown>;
    };
    const matches = data.FaceMatches ?? [];
    const unmatched = data.UnmatchedFaces ?? [];
    const best = matches.reduce((max, m) => Math.max(max, m.Similarity ?? 0), 0);
    return {
      similarity: best / 100,
      matches: matches.length,
      unmatched: unmatched.length,
    };
  } catch {
    return null;
  }
}
