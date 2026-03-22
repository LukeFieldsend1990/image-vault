import { SignJWT, jwtVerify } from "jose";

const ISSUER = "image-vault";
const AUDIENCE = "image-vault-app";
const SESSION_TTL = "2h";

export interface SessionPayload {
  sub: string;      // userId
  email: string;
  role: string;
}

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionJwt(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(SESSION_TTL)
    .sign(getSecret(secret));
}

export async function verifySessionJwt(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}
