import { describe, it, expect } from "vitest";
import { sha256HexFromStream } from "@/lib/crypto/hash";

function streamFrom(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("sha256HexFromStream", () => {
  it("hashes 'abc' to the known SHA-256 vector", async () => {
    const hex = await sha256HexFromStream(streamFrom(new TextEncoder().encode("abc")));
    expect(hex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes the empty input to the known empty-string digest", async () => {
    const hex = await sha256HexFromStream(streamFrom(new Uint8Array(0)));
    expect(hex).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("produces 64 lowercase hex chars across multiple chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const hex = await sha256HexFromStream(stream);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
