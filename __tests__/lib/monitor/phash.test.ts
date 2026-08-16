import { describe, it, expect } from "vitest";
import jpeg from "jpeg-js";
import * as UPNG from "upng-js";

import {
  MAX_DECODE_PIXELS,
  MAX_ENCODED_BYTES,
  dhash64FromRgba,
  hammingDistance64,
  hashImage,
  hashToHex,
  parseImageDims,
} from "@/lib/monitor/phash";

/** Synthetic RGBA frame: per-pixel luma from a callback. */
function frame(width: number, height: number, luma: (x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(luma(x, y))));
      const p = (y * width + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return data;
}

const rampLuma = (x: number) => x; // brightens left→right
const invRampLuma = (width: number) => (x: number) => width - 1 - x;

describe("hammingDistance64", () => {
  it("known vectors", () => {
    expect(hammingDistance64("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance64("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance64("0000000000000001", "0000000000000000")).toBe(1);
    expect(hammingDistance64("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f")).toBe(64);
    expect(hammingDistance64("00000000000000ff", "0000000000000f0f")).toBe(8);
  });
});

describe("dhash64FromRgba", () => {
  it("identical frames hash identically", () => {
    const a = dhash64FromRgba(frame(90, 80, rampLuma), 90, 80);
    const b = dhash64FromRgba(frame(90, 80, rampLuma), 90, 80);
    expect(a).toBe(b);
  });

  it("the same gradient at two resolutions lands within a few bits", () => {
    const small = dhash64FromRgba(frame(90, 80, (x) => (x / 89) * 255), 90, 80);
    const large = dhash64FromRgba(frame(360, 320, (x) => (x / 359) * 255), 360, 320);
    expect(hammingDistance64(hashToHex(small), hashToHex(large))).toBeLessThanOrEqual(4);
  });

  it("an inverted gradient is maximally distant", () => {
    const ramp = dhash64FromRgba(frame(90, 80, rampLuma), 90, 80);
    const inv = dhash64FromRgba(frame(90, 80, invRampLuma(90)), 90, 80);
    expect(hammingDistance64(hashToHex(ramp), hashToHex(inv))).toBeGreaterThanOrEqual(56);
  });
});

describe("parseImageDims", () => {
  it("reads PNG IHDR dimensions", () => {
    const png = new Uint8Array(
      UPNG.encode([frame(33, 21, rampLuma).buffer as ArrayBuffer], 33, 21, 0)
    );
    expect(parseImageDims(png)).toEqual({ width: 33, height: 21, format: "png" });
  });

  it("reads JPEG SOF dimensions", () => {
    const encoded = jpeg.encode({ data: frame(48, 32, rampLuma), width: 48, height: 32 }, 80);
    const dims = parseImageDims(new Uint8Array(encoded.data));
    expect(dims).toEqual({ width: 48, height: 32, format: "jpeg" });
  });

  it("returns null for unknown containers and truncated data", () => {
    expect(parseImageDims(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseImageDims(new Uint8Array(32).fill(0x20))).toBeNull();
  });
});

describe("hashImage", () => {
  it("round-trips a JPEG and a PNG of the same frame to nearby hashes", () => {
    const src = frame(96, 96, (x, y) => (x + y) * 1.3);
    const asJpeg = new Uint8Array(jpeg.encode({ data: src, width: 96, height: 96 }, 90).data);
    const asPng = new Uint8Array(UPNG.encode([src.buffer as ArrayBuffer], 96, 96, 0));

    const a = hashImage(asJpeg);
    const b = hashImage(asPng);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.width).toBe(96);
    expect(b!.height).toBe(96);
    // JPEG quantisation may flip a couple of gradient bits, no more.
    expect(hammingDistance64(a!.hashHex, b!.hashHex)).toBeLessThanOrEqual(6);
  });

  it("refuses oversized payloads and megapixel counts", () => {
    expect(hashImage(new Uint8Array(MAX_ENCODED_BYTES + 1))).toBeNull();

    // Forge a PNG header claiming huge dimensions — must be rejected by the
    // pixel gate before any decode is attempted.
    const big = 4096; // 4096 * 2048 > MAX_DECODE_PIXELS
    const png = new Uint8Array(
      UPNG.encode([frame(8, 8, rampLuma).buffer as ArrayBuffer], 8, 8, 0)
    );
    png[16] = (big >> 24) & 0xff;
    png[17] = (big >> 16) & 0xff;
    png[18] = (big >> 8) & 0xff;
    png[19] = big & 0xff;
    png[20] = 0;
    png[21] = 0;
    png[22] = (2048 >> 8) & 0xff;
    png[23] = 2048 & 0xff;
    expect(8 * 8).toBeLessThan(MAX_DECODE_PIXELS);
    expect(big * 2048).toBeGreaterThan(MAX_DECODE_PIXELS);
    expect(hashImage(png)).toBeNull();
  });

  it("returns null for webp (unmeasured, not zero)", () => {
    // Minimal RIFF/WEBP magic — sniffed as webp, which v1 does not decode.
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(hashImage(webp)).toBeNull();
  });
});
