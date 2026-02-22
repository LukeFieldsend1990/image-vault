import { NextResponse } from "next/server";

const SESSION_MAX_AGE = 900;       // 15 minutes
const REFRESH_MAX_AGE = 604_800;   // 7 days

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function setAuthCookies(
  response: NextResponse,
  sessionJwt: string,
  refreshToken: string
): void {
  const secure = process.env.NODE_ENV !== "development";
  const cookieBase = `; HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;

  response.headers.append(
    "Set-Cookie",
    `session=${sessionJwt}; Max-Age=${SESSION_MAX_AGE}${cookieBase}`
  );
  response.headers.append(
    "Set-Cookie",
    `refresh=${refreshToken}; Max-Age=${REFRESH_MAX_AGE}${cookieBase}`
  );
}

export function clearAuthCookies(response: NextResponse): void {
  const cookieBase = "; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
  response.headers.append("Set-Cookie", `session=${cookieBase}`);
  response.headers.append("Set-Cookie", `refresh=${cookieBase}`);
}
