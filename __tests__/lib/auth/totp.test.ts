import { describe, it, expect } from "vitest";
import { generateTotpSecret, buildOtpauthUrl, verifyTotpCode } from "@/lib/auth/totp";
import * as OTPAuth from "otpauth";

describe("totp", () => {
  it("generateTotpSecret returns a base32 string", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it("generates unique secrets each call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
  });

  it("buildOtpauthUrl produces a valid otpauth URI", () => {
    const secret = generateTotpSecret();
    const url = buildOtpauthUrl("user@example.com", secret);
    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("Image%20Vault");
    expect(url).toContain("user%40example.com");
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain("digits=6");
    expect(url).toContain("period=30");
  });

  it("verifyTotpCode accepts a valid current code", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const code = totp.generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("verifyTotpCode rejects an obviously wrong code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("verifyTotpCode strips spaces from input", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const code = totp.generate();
    const spaced = code.slice(0, 3) + " " + code.slice(3);
    expect(verifyTotpCode(secret, spaced)).toBe(true);
  });
});
