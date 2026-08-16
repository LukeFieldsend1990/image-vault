// upng-js ships no types; only the entry points the pHash modules use.
// (Global declaration file on purpose — `declare module` shims must live
// outside a module for TypeScript to register them. Kept in sync with
// pipeline-worker/worker-env.d.ts.)
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
