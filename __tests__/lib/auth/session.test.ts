import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "@/lib/auth/session";

describe("session utilities", () => {
  describe("generateToken", () => {
    it("returns a 64-char hex string (32 bytes)", () => {
      const token = generateToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates unique tokens", () => {
      const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
      expect(tokens.size).toBe(20);
    });
  });

  describe("hashToken", () => {
    it("returns a 64-char hex string (SHA-256)", async () => {
      const hash = await hashToken("test-token");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", async () => {
      const a = await hashToken("same-input");
      const b = await hashToken("same-input");
      expect(a).toBe(b);
    });

    it("produces different hashes for different inputs", async () => {
      const a = await hashToken("token-a");
      const b = await hashToken("token-b");
      expect(a).not.toBe(b);
    });
  });
});
