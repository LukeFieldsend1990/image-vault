import * as OTPAuth from "otpauth";

export function generateTotpSecret(): string {
  const totp = new OTPAuth.TOTP({ digits: 6, period: 30 });
  return totp.secret.base32;
}

export function buildOtpauthUrl(email: string, secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: "Image Vault",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  // Allow ±1 period window
  const delta = totp.validate({ token: code.replace(/\s/g, ""), window: 1 });
  return delta !== null;
}
