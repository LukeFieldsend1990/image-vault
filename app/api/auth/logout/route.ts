export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshTokens } from "@/lib/db/schema";
import { hashToken, clearAuthCookies } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const refreshCookie = req.cookies.get("refresh")?.value;

  if (refreshCookie) {
    try {
      const tokenHash = await hashToken(refreshCookie);
      const db = getDb();
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    } catch {
      // Best-effort; continue clearing cookies
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearAuthCookies(response);
  return response;
}
