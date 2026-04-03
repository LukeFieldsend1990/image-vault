import { describe, it, expect } from "vitest";
import { signSessionJwt, verifySessionJwt, type SessionPayload } from "@/lib/auth/jwt";

const SECRET = "test-secret-key-for-unit-tests-only";

const testPayload: SessionPayload = {
  sub: "user-123",
  email: "test@example.com",
  role: "talent",
};

describe("jwt", () => {
  it("signSessionJwt returns a three-part JWT string", async () => {
    const token = await signSessionJwt(testPayload, SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifySessionJwt round-trips a valid token", async () => {
    const token = await signSessionJwt(testPayload, SECRET);
    const result = await verifySessionJwt(token, SECRET);
    expect(result).toEqual(testPayload);
  });

  it("verifySessionJwt returns null for wrong secret", async () => {
    const token = await signSessionJwt(testPayload, SECRET);
    const result = await verifySessionJwt(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("verifySessionJwt returns null for garbage input", async () => {
    expect(await verifySessionJwt("not.a.jwt", SECRET)).toBeNull();
    expect(await verifySessionJwt("", SECRET)).toBeNull();
  });

  it("JWT payload contains expected OIDC claims", async () => {
    const token = await signSessionJwt(testPayload, SECRET);
    const [, payloadB64] = token.split(".");
    const claims = JSON.parse(atob(payloadB64));
    expect(claims.iss).toBe("image-vault");
    expect(claims.aud).toBe("image-vault-app");
    expect(claims.sub).toBe("user-123");
    expect(claims.email).toBe("test@example.com");
    expect(claims.role).toBe("talent");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("different roles are preserved in the token", async () => {
    for (const role of ["talent", "rep", "licensee", "admin"]) {
      const token = await signSessionJwt({ ...testPayload, role }, SECRET);
      const result = await verifySessionJwt(token, SECRET);
      expect(result?.role).toBe(role);
    }
  });
});
