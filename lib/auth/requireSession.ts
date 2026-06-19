import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySessionJwt, type SessionPayload } from "./jwt";

/** KV key prefix for the session-revocation denylist (see revoke_user_sessions MCP tool). */
export const SESSION_REVOKED_PREFIX = "session_revoked:";

/**
 * Pure decision for the session-revocation denylist. A user can have all
 * sessions issued before `revokedAt` killed while still being able to log in
 * again (a fresh JWT has a later `iat`). Tokens with no `iat` are treated as
 * issued at 0 — i.e. revoked — so they fail closed toward re-authentication.
 */
export function isSessionRevoked(revokedAtRaw: string | null, iat: number | undefined): boolean {
  if (!revokedAtRaw) return false;
  const revokedAt = parseInt(revokedAtRaw, 10);
  if (!Number.isFinite(revokedAt)) return false;
  return (iat ?? 0) < revokedAt;
}

export async function requireSession(
  req: NextRequest
): Promise<SessionPayload | NextResponse> {
  const token = req.cookies.get("session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { env } = getCloudflareContext();
  const payload = await verifySessionJwt(token, env.JWT_SECRET);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Session-revocation denylist: lets an admin force-logout a user before the
  // stateless JWT expires (revoke_user_sessions). Fail-open on KV errors — the
  // JWT is still cryptographically valid and the window is bounded by its TTL,
  // so a KV blip must not take down auth platform-wide.
  try {
    const revokedAtRaw = await env.SESSIONS_KV.get(`${SESSION_REVOKED_PREFIX}${payload.sub}`);
    if (isSessionRevoked(revokedAtRaw, payload.iat)) {
      return NextResponse.json({ error: "Session revoked" }, { status: 401 });
    }
  } catch {
    // ignore — treat as not revoked
  }

  return payload;
}

export function isErrorResponse(
  result: SessionPayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
