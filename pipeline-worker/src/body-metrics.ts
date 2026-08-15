/**
 * Body-geometry context: a streaming width-profile pass over a full-body
 * OBJ (same line-streaming pattern as geo-fingerprint-worker) yielding
 * relative proportions.
 *
 * Honest limits, up front: OBJ vertex clouds carry no absolute scale, so
 * everything here is a ratio of bounding-box height; width heuristics
 * cannot tell muscle from clothing from scan artifacts; and no
 * candidate-side measurement exists. These numbers are adjudicator CONTEXT
 * (one guarded prompt line, gated off by default) — never a detection
 * signal, never a flag reason. See docs/deepfake-detection.md.
 */

export const BODY_METRICS_ALGORITHM = "width-profile-v1";

const SLICES = 64;

export interface BodyMetrics {
  /** Bounding-box height in the mesh's own units (scale-free beyond this). */
  heightUnits: number;
  /** Max width in the shoulder band (78-90% of height), over height. */
  shoulderWidthRatio: number;
  /** Max width in the hip band (45-58% of height), over height. */
  hipWidthRatio: number;
  /** Min width between hip and shoulder bands, over height. */
  waistWidthRatio: number;
  shoulderToHip: number;
  /** Height fraction of the widest hip-band slice — a rough leg-length proxy. */
  hipHeightRatio: number;
  sliceCount: number;
}

type LineSink = (x: number, y: number, z: number) => void;

/** Stream an OBJ, feeding every vertex position to the sink. O(1) memory. */
async function streamVertices(stream: ReadableStream<Uint8Array>, sink: LineSink): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let count = 0;

  const processLine = (line: string) => {
    const t = line.trimStart();
    if (!t.startsWith("v ") && !t.startsWith("v\t")) return;
    const parts = t.split(/\s+/);
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return;
    count++;
    sink(x, y, z);
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
    if (lastNl === -1) {
      remainder = text;
      continue;
    }
    const lines = text.slice(0, lastNl).split("\n");
    remainder = text.slice(lastNl + 1);
    for (const line of lines) processLine(line);
  }
  return count;
}

/**
 * Two streaming passes: bbox first, then a per-Y-slice width histogram.
 * `getStream` is called once per pass (R2 objects stream once).
 */
export async function computeBodyMetrics(
  getStream: () => Promise<ReadableStream<Uint8Array> | null>
): Promise<BodyMetrics | null> {
  const pass1 = await getStream();
  if (!pass1) return null;
  let minY = Infinity,
    maxY = -Infinity;
  const vertexCount = await streamVertices(pass1, (_x, y) => {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  if (vertexCount < 100 || !(maxY > minY)) return null;
  const height = maxY - minY;

  const pass2 = await getStream();
  if (!pass2) return null;
  const minX = new Float64Array(SLICES).fill(Infinity);
  const maxX = new Float64Array(SLICES).fill(-Infinity);
  await streamVertices(pass2, (x, y) => {
    const slice = Math.min(SLICES - 1, Math.max(0, Math.floor(((y - minY) / height) * SLICES)));
    if (x < minX[slice]) minX[slice] = x;
    if (x > maxX[slice]) maxX[slice] = x;
  });
  const widths: number[] = [];
  for (let i = 0; i < SLICES; i++) {
    widths.push(maxX[i] > minX[i] ? maxX[i] - minX[i] : 0);
  }

  return deriveBodyMetrics(widths, height);
}

/** Pure derivation from a width histogram — exported for tests. Slice 0 is
 *  the bottom of the figure. */
export function deriveBodyMetrics(widths: number[], heightUnits: number): BodyMetrics | null {
  const slices = widths.length;
  if (slices < 16 || heightUnits <= 0) return null;

  const band = (fromFrac: number, toFrac: number) => {
    const from = Math.floor(fromFrac * slices);
    const to = Math.min(slices - 1, Math.floor(toFrac * slices));
    return widths.slice(from, to + 1);
  };
  const maxIn = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0);
  const minPositiveIn = (values: number[]) => {
    const positive = values.filter((w) => w > 0);
    return positive.length ? Math.min(...positive) : 0;
  };

  const shoulder = maxIn(band(0.78, 0.9));
  const hipBand = band(0.45, 0.58);
  const hip = maxIn(hipBand);
  const waist = minPositiveIn(band(0.58, 0.78));
  if (shoulder <= 0 || hip <= 0) return null;

  const hipFrom = Math.floor(0.45 * slices);
  const hipSlice = hipFrom + hipBand.indexOf(hip);

  return {
    heightUnits,
    shoulderWidthRatio: shoulder / heightUnits,
    hipWidthRatio: hip / heightUnits,
    waistWidthRatio: waist / heightUnits,
    shoulderToHip: shoulder / hip,
    hipHeightRatio: hipSlice / slices,
    sliceCount: slices,
  };
}
