/**
 * Trimmed mirror of lib/monitor/phash.ts for the pipeline worker — PNG only,
 * because the derived-stills job hashes renders it just produced, and those
 * are always PNGs. Grid maths and the dhash-v1 contract must stay identical
 * to the app module: the sweep compares these hashes against candidate
 * hashes computed there.
 */

import * as UPNG from "upng-js";

export const PHASH_ALGORITHM = "dhash-v1";

const GRID_W = 9;
const GRID_H = 8;

export function dhash64FromRgba(rgba: Uint8Array, width: number, height: number): bigint {
  const sums = new Float64Array(GRID_W * GRID_H);
  const counts = new Float64Array(GRID_W * GRID_H);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / width));
      const p = (y * width + x) * 4;
      const luma = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
      const cell = gy * GRID_W + gx;
      sums[cell] += luma;
      counts[cell] += 1;
    }
  }

  let hash = 0n;
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W - 1; gx++) {
      const left = sums[gy * GRID_W + gx] / (counts[gy * GRID_W + gx] || 1);
      const right = sums[gy * GRID_W + gx + 1] / (counts[gy * GRID_W + gx + 1] || 1);
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash;
}

/** Hash a PNG the job just rendered. Null on any decode failure. */
export function hashPng(
  bytes: Uint8Array
): { hashHex: string; width: number; height: number } | null {
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const img = UPNG.decode(buf);
    const frames = UPNG.toRGBA8(img);
    if (!frames.length) return null;
    const hash = dhash64FromRgba(new Uint8Array(frames[0]), img.width, img.height);
    return { hashHex: hash.toString(16).padStart(16, "0"), width: img.width, height: img.height };
  } catch {
    return null;
  }
}
