/**
 * Perceptual hashing for the derivation layer of the likeness monitor.
 *
 * A 64-bit dHash (difference hash): downsample to a 9×8 luma grid, emit one
 * bit per horizontal gradient. Two images that are the same picture — through
 * recompression, resizing, mild colour shifts — land within a few bits of
 * each other; unrelated pictures differ by ~32. The reading feeds the
 * `perceptualHashDistance` candidate signal, whose 0-64 Hamming contract
 * (<=16 ⇒ derivation from reference imagery) predates this module.
 *
 * What it cannot do: survive crops, flips, or novel synthesis. A face-swap
 * *generated from* a scan still normally will not match — composition
 * differs. Distance is evidence of derivation, never of innocence.
 *
 * Everything here is pure CPU with pure-JS decoders (jpeg-js / upng-js) —
 * no canvas, no wasm, no AI spend. Decoding is full-frame RGBA against a
 * 128MB Worker limit, so the size gates below are load-bearing: oversized
 * or unsupported images return null ("not measured"), they never throw.
 */

import jpeg from "jpeg-js";
import * as UPNG from "upng-js";
import { sniffImageMediaType } from "@/lib/ai/providers";

export const PHASH_ALGORITHM = "dhash-v1";

/** Refuse to decode above this many pixels (~17MB RGBA at 4.2MP). */
export const MAX_DECODE_PIXELS = 4_200_000;

/** Refuse to decode encoded payloads above this size. */
export const MAX_ENCODED_BYTES = 3_000_000;

const GRID_W = 9;
const GRID_H = 8;

export interface DecodedRgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

/**
 * Read dimensions from the container header without decoding pixels — the
 * cheap gate that keeps a 60MP still from OOMing the worker.
 */
export function parseImageDims(
  bytes: Uint8Array
): { width: number; height: number; format: "jpeg" | "png" } | null {
  const type = sniffImageMediaType(bytes);
  if (type === "image/png") {
    // Signature (8) + IHDR length/type (8), then width/height as u32 BE.
    if (bytes.length < 24) return null;
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width <= 0 || height <= 0) return null;
    return { width, height, format: "png" };
  }
  if (type === "image/jpeg") {
    // Walk the marker stream to the first SOFn frame header.
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      // Padding / standalone markers carry no length.
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 && // DHT
        marker !== 0xc8 && // JPG extension
        marker !== 0xcc; // DAC
      if (isSof) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        if (width <= 0 || height <= 0) return null;
        return { width, height, format: "jpeg" };
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  return null;
}

/** Decode to full-frame RGBA. Callers must gate size first. */
export function decodeToRgba(bytes: Uint8Array): DecodedRgba | null {
  const dims = parseImageDims(bytes);
  if (!dims) return null;
  try {
    if (dims.format === "jpeg") {
      const out = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: Math.ceil(MAX_DECODE_PIXELS / 1_000_000),
        maxMemoryUsageInMB: 64,
      });
      return { width: out.width, height: out.height, data: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength) };
    }
    // upng wants a standalone ArrayBuffer, not a view into a larger one.
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const img = UPNG.decode(buf);
    const frames = UPNG.toRGBA8(img);
    if (!frames.length) return null;
    return { width: img.width, height: img.height, data: new Uint8Array(frames[0]) };
  } catch {
    return null;
  }
}

/**
 * 64-bit dHash over an RGBA frame: area-average down to a 9×8 luma grid,
 * then one bit per horizontal gradient (left brighter than right).
 */
export function dhash64FromRgba(rgba: Uint8Array, width: number, height: number): bigint {
  // Area-average luma into the grid — every source pixel lands in exactly
  // one cell, so scale changes wash out instead of aliasing.
  const sums = new Float64Array(GRID_W * GRID_H);
  const counts = new Float64Array(GRID_W * GRID_H);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / width));
      const p = (y * width + x) * 4;
      // Rec. 601 luma.
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

export function hashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

/**
 * The composed entry point: gate, decode, hash. Returns null for anything
 * that cannot be measured honestly — oversized, undecodable, webp/gif.
 */
export function hashImage(
  bytes: Uint8Array
): { hashHex: string; width: number; height: number } | null {
  if (bytes.byteLength > MAX_ENCODED_BYTES) return null;
  const dims = parseImageDims(bytes);
  if (!dims) return null;
  if (dims.width * dims.height > MAX_DECODE_PIXELS) return null;
  const decoded = decodeToRgba(bytes);
  if (!decoded) return null;
  const hash = dhash64FromRgba(decoded.data, decoded.width, decoded.height);
  return { hashHex: hashToHex(hash), width: decoded.width, height: decoded.height };
}

/** Hamming distance between two 16-hex-char dHashes: 0-64. */
export function hammingDistance64(aHex: string, bHex: string): number {
  let diff = BigInt(`0x${aHex}`) ^ BigInt(`0x${bHex}`);
  let count = 0;
  while (diff) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}
