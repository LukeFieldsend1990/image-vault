// Ambient declarations for the pipeline worker.

// upng-js ships no types; only the entry points the derived-stills pHash
// mirror uses (kept in sync with the declaration in the root env.d.ts).
declare module "upng-js" {
  interface UpngImage {
    width: number;
    height: number;
    depth: number;
    ctype: number;
  }
  export function decode(buffer: ArrayBuffer): UpngImage;
  export function toRGBA8(img: UpngImage): ArrayBuffer[];
  export function encode(
    frames: ArrayBuffer[],
    width: number,
    height: number,
    colourCount?: number
  ): ArrayBuffer;
}
