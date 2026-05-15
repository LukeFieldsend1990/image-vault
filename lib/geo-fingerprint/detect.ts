import { parseObj, computeBbox, estimateNormals } from "./objParser";
import { bitsFromHex, selectVertices } from "./payload";

export interface FingerprintRecord {
  id: string;
  licenceId: string;
  licenseeId: string;
  fileId: string;
  fingerprintBits: string;
  fingerprintBitsLength: number;
  repeatFactor: number;
}

export interface DetectionMatch {
  fingerprintId: string;
  licenceId: string;
  licenseeId: string;
  confidence: number;
  bitsRecovered: number;
  bitsExpected: number;
  bitErrorRate: number;
  evidenceSummary: string;
}

export async function detectFingerprint(
  suspectObjText: string,
  originalObjText: string,
  fingerprints: FingerprintRecord[],
): Promise<DetectionMatch[]> {
  const suspect = parseObj(suspectObjText);
  const original = parseObj(originalObjText);

  if (suspect.vertices.length === 0 || original.vertices.length === 0) return [];

  const origBbox = computeBbox(original.vertices);
  const suspectBbox = computeBbox(suspect.vertices);

  // Normalize both meshes: translate centroid to origin, scale by orig diagonal
  const normalize = (verts: Float64Array[], cx: number, cy: number, cz: number, scale: number) =>
    verts.map(
      (v) =>
        new Float64Array([
          (v[0] - cx) / scale,
          (v[1] - cy) / scale,
          (v[2] - cz) / scale,
        ]),
    );

  const origNorm = normalize(
    original.vertices,
    origBbox.centroid[0],
    origBbox.centroid[1],
    origBbox.centroid[2],
    origBbox.diagonal,
  );
  const suspectNorm = normalize(
    suspect.vertices,
    suspectBbox.centroid[0],
    suspectBbox.centroid[1],
    suspectBbox.centroid[2],
    origBbox.diagonal,
  );

  const origNormals = estimateNormals(origNorm, original.faces);
  const matches: DetectionMatch[] = [];

  for (const fp of fingerprints) {
    const expectedBits = bitsFromHex(fp.fingerprintBits, fp.fingerprintBitsLength);

    // Reconstruct hmacBytes from stored bits hex (first 16 bytes for vertex selection seed)
    const hmacBytes = new Uint8Array(Math.ceil(fp.fingerprintBitsLength / 8));
    for (let i = 0; i < hmacBytes.length; i++) {
      hmacBytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);
    }

    const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
    const selectedVertices = selectVertices(
      hmacBytes,
      fp.fileId,
      original.vertices.length,
      slotCount,
    );

    const extractedBits: boolean[] = new Array(slotCount).fill(false);
    for (let i = 0; i < slotCount; i++) {
      const vi = selectedVertices[i];
      if (vi >= origNorm.length || vi >= suspectNorm.length) continue;
      const orig = origNorm[vi];
      const susp = suspectNorm[vi];
      const n = origNormals[vi];
      const projection =
        (susp[0] - orig[0]) * n[0] +
        (susp[1] - orig[1]) * n[1] +
        (susp[2] - orig[2]) * n[2];
      extractedBits[i] = projection > 0;
    }

    // Majority vote per logical bit
    let correctBits = 0;
    for (let j = 0; j < fp.fingerprintBitsLength; j++) {
      const start = j * fp.repeatFactor;
      let votes = 0;
      for (let k = 0; k < fp.repeatFactor; k++) votes += extractedBits[start + k] ? 1 : 0;
      const votedBit = votes > fp.repeatFactor / 2;
      if (votedBit === expectedBits[j]) correctBits++;
    }

    const confidence = correctBits / fp.fingerprintBitsLength;
    const bitErrorRate = 1 - confidence;

    if (confidence < 0.6) continue;

    let evidenceSummary: string;
    if (confidence >= 0.9) {
      evidenceSummary = `Strong match to licence ${fp.licenceId}`;
    } else if (confidence >= 0.75) {
      evidenceSummary = `Possible match to licence ${fp.licenceId} — manual review advised`;
    } else {
      evidenceSummary = `Weak signal, may be coincidental`;
    }

    matches.push({
      fingerprintId: fp.id,
      licenceId: fp.licenceId,
      licenseeId: fp.licenseeId,
      confidence,
      bitsRecovered: correctBits,
      bitsExpected: fp.fingerprintBitsLength,
      bitErrorRate,
      evidenceSummary,
    });
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
