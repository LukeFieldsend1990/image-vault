export interface ParsedObj {
  vertices: Float64Array[];
  vertexLineIndices: number[];
  lines: string[];
  faces: number[][];
}

export function parseObj(text: string): ParsedObj {
  const lines = text.split("\n");
  const vertices: Float64Array[] = [];
  const vertexLineIndices: number[] = [];
  const faces: number[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("v ") || line.startsWith("v\t")) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        vertices.push(new Float64Array([x, y, z]));
        vertexLineIndices.push(i);
      }
    } else if (line.startsWith("f ") || line.startsWith("f\t")) {
      const parts = line.split(/\s+/).slice(1);
      const faceVerts: number[] = [];
      for (const part of parts) {
        const idx = parseInt(part.split("/")[0]) - 1; // OBJ is 1-indexed
        if (!isNaN(idx) && idx >= 0) faceVerts.push(idx);
      }
      if (faceVerts.length >= 3) faces.push(faceVerts);
    }
  }

  return { vertices, vertexLineIndices, lines, faces };
}

export interface BboxInfo {
  min: [number, number, number];
  max: [number, number, number];
  diagonal: number;
  centroid: [number, number, number];
}

export function computeBbox(vertices: Float64Array[]): BboxInfo {
  if (vertices.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], diagonal: 1, centroid: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    diagonal,
    centroid: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

export function estimateNormals(vertices: Float64Array[], faces: number[][]): Float64Array[] {
  const normals = vertices.map(() => new Float64Array(3));

  for (const face of faces) {
    for (let tri = 0; tri < face.length - 2; tri++) {
      const ai = face[0], bi = face[tri + 1], ci = face[tri + 2];
      if (ai >= vertices.length || bi >= vertices.length || ci >= vertices.length) continue;
      const a = vertices[ai], b = vertices[bi], c = vertices[ci];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      normals[ai][0] += nx; normals[ai][1] += ny; normals[ai][2] += nz;
      normals[bi][0] += nx; normals[bi][1] += ny; normals[bi][2] += nz;
      normals[ci][0] += nx; normals[ci][1] += ny; normals[ci][2] += nz;
    }
  }

  for (const n of normals) {
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (len > 0) {
      n[0] /= len; n[1] /= len; n[2] /= len;
    } else {
      n[1] = 1; // fallback: up
    }
  }

  return normals;
}

export function serializeObj(parsed: ParsedObj, modifiedVertices: Float64Array[]): string {
  const lines = [...parsed.lines];
  for (let i = 0; i < modifiedVertices.length; i++) {
    const lineIdx = parsed.vertexLineIndices[i];
    const v = modifiedVertices[i];
    lines[lineIdx] = `v ${v[0].toFixed(8)} ${v[1].toFixed(8)} ${v[2].toFixed(8)}`;
  }
  return lines.join("\n");
}
