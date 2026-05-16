import { parseObj } from "./objParser";
import { bitsFromHex, selectVertices, slotDirection } from "./payload";

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

  const matches: DetectionMatch[] = [];

  for (const fp of fingerprints) {
    // Skip v1 fingerprints (embedded with normals, incompatible with slot-direction detection)
    const expectedBits = bitsFromHex(fp.fingerprintBits, fp.fingerprintBitsLength);

    // Reconstruct hmacBytes from stored bits hex (16 bytes = 32 hex chars)
    const byteCount = Math.min(fp.fingerprintBits.length / 2, 16);
    const hmacBytes = new Uint8Array(16);
    for (let i = 0; i < byteCount; i++) {
      hmacBytes[i] = parseInt(fp.fingerprintBits.slice(i * 2, i * 2 + 2), 16);
    }

    const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
    const selectedVerts = selectVertices(
      hmacBytes,
      fp.fileId,
      original.vertices.length,
      slotCount,
    );

    // For each slot: project (suspect - original) displacement onto the slot direction
    const extractedBits: boolean[] = new Array(slotCount).fill(false);
    for (let i = 0; i < slotCount; i++) {
      const vi = selectedVerts[i];
      if (vi >= original.vertices.length || vi >= suspect.vertices.length) continue;
      const orig = original.vertices[vi];
      const susp = suspect.vertices[vi];
      const [dirX, dirY, dirZ] = slotDirection(hmacBytes, i);
      const dx = susp[0] - orig[0];
      const dy = susp[1] - orig[1];
      const dz = susp[2] - orig[2];
      extractedBits[i] = dx * dirX + dy * dirY + dz * dirZ > 0;
    }

    // Majority vote per logical bit
    let correctBits = 0;
    for (let j = 0; j < fp.fingerprintBitsLength; j++) {
      const start = j * fp.repeatFactor;
      let votes = 0;
      for (let k = 0; k < fp.repeatFactor; k++) votes += extractedBits[start + k] ? 1 : 0;
      if (votes > fp.repeatFactor / 2 === expectedBits[j]) correctBits++;
    }

    const confidence = correctBits / fp.fingerprintBitsLength;
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
      bitErrorRate: 1 - confidence,
      evidenceSummary,
    });
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
