import { parseObj, computeBbox, estimateNormals, serializeObj } from "./objParser";
import { generateFingerprintBits, selectVertices } from "./payload";
import type { FingerprintParams } from "./payload";

export interface EmbedResult {
  watermarkedObjText: string;
  fingerprintBitsHex: string;
  payloadHash: string;
  regionCount: number;
  vertexCount: number;
  faceCount: number;
  bboxDiagonal: number;
  maxDisplacement: number;
}

const BIT_LENGTH = 128;
const REPEAT_FACTOR = 5;
const SLOT_COUNT = BIT_LENGTH * REPEAT_FACTOR;

export async function embedFingerprint(
  objText: string,
  params: FingerprintParams,
  secret: string,
  strength = 0.00001,
): Promise<EmbedResult> {
  const parsed = parseObj(objText);
  const { vertices, faces } = parsed;

  if (vertices.length === 0) throw new Error("OBJ has no vertices");
  if (vertices.length < 10) throw new Error("OBJ has too few vertices for fingerprinting");

  const { diagonal } = computeBbox(vertices);
  const normals = estimateNormals(vertices, faces);

  const { bits, bitsHex, payloadHash, hmacBytes } = await generateFingerprintBits(
    params,
    secret,
    BIT_LENGTH,
  );

  const expandedBits = Array.from(
    { length: SLOT_COUNT },
    (_, i) => bits[Math.floor(i / REPEAT_FACTOR)],
  );

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

  const watermarkedObjText = serializeObj(parsed, modified);

  return {
    watermarkedObjText,
    fingerprintBitsHex: bitsHex,
    payloadHash,
    regionCount: new Set(selectedVertices).size,
    vertexCount: vertices.length,
    faceCount: faces.length,
    bboxDiagonal: diagonal,
    maxDisplacement: offsetAmount,
  };
}
