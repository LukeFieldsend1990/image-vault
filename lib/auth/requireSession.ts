import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { verifySessionJwt, type SessionPayload } from "./jwt";

export async function requireSession(
  req: NextRequest
): Promise<SessionPayload | NextResponse> {
  const token = req.cookies.get("session")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { env } = getRequestContext();
  const payload = await verifySessionJwt(token, env.JWT_SECRET);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  return payload;
}

export function isErrorResponse(
  result: SessionPayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
