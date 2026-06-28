import { describe, it, expect } from "vitest";
import { signImageToken, verifyImageToken } from "@/lib/pitch/imageToken";

const SECRET = "test-secret-0123456789abcdef";
const KEY = "scans/9f3a/portrait frame.jpg"; // includes a space + slashes

describe("pitch image token", () => {
  it("round-trips a valid token and recovers the r2 key", async () => {
    const token = await signImageToken(SECRET, KEY, 3600);
    const result = await verifyImageToken(SECRET, token);
    expect(result).toEqual({ r2Key: KEY });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signImageToken(SECRET, KEY, 3600);
    expect(await verifyImageToken("wrong-secret", token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signImageToken(SECRET, KEY, 3600);
    // Verify 2 hours in the future — past the 1h TTL.
    const future = Math.floor(Date.now() / 1000) + 7200;
    expect(await verifyImageToken(SECRET, token, future)).toBeNull();
  });

  it("rejects a token whose key has been swapped (signature no longer matches)", async () => {
    const token = await signImageToken(SECRET, KEY, 3600);
    const [, exp, sig] = token.split(".");
    const forgedKey = Buffer.from("scans/other/secret.jpg").toString("base64url");
    const forged = `${forgedKey}.${exp}.${sig}`;
    expect(await verifyImageToken(SECRET, forged, Number(exp) - 1)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyImageToken(SECRET, "not-a-token")).toBeNull();
    expect(await verifyImageToken(SECRET, "a.b")).toBeNull();
    expect(await verifyImageToken(SECRET, "")).toBeNull();
  });
});
