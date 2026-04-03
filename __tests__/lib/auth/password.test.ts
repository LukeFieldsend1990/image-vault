import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, dummyPasswordCheck } from "@/lib/auth/password";

describe("password", () => {
  it("hashPassword returns a pbkdf2:v1 formatted string", async () => {
    const hash = await hashPassword("securepassword");
    expect(hash).toMatch(/^pbkdf2:v1:100000:[a-f0-9]{32}:[a-f0-9]{64}$/);
  });

  it("hashing the same password twice produces different salts", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("verifyPassword returns true for correct password", async () => {
    const hash = await hashPassword("my-password-123");
    const ok = await verifyPassword("my-password-123", hash);
    expect(ok).toBe(true);
  });

  it("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("correct-password");
    const ok = await verifyPassword("wrong-password", hash);
    expect(ok).toBe(false);
  });

  it("verifyPassword returns false for malformed stored hash", async () => {
    expect(await verifyPassword("pw", "not-a-hash")).toBe(false);
    expect(await verifyPassword("pw", "pbkdf2:v2:100000:aa:bb")).toBe(false);
    expect(await verifyPassword("pw", "")).toBe(false);
  });

  it("dummyPasswordCheck completes without error", async () => {
    await expect(dummyPasswordCheck()).resolves.toBeUndefined();
  });
});
