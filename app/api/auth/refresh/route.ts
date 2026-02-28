export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, refreshTokens } from "@/lib/db/schema";
import { signSessionJwt } from "@/lib/auth/jwt";
import { generateToken, hashToken, setAuthCookies, clearAuthCookies } from "@/lib/auth/session";
import { eq, and, gt } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/dashboard";

  // Build a safe same-origin redirect target
  function makeRedirect(path: string): URL {
    const url = req.nextUrl.clone();
    url.pathname = path.startsWith("/") ? path : "/dashboard";
    url.search = "";
    return url;
  }

  const rawRefresh = req.cookies.get("refresh")?.value;
  if (!rawRefresh) {
    return NextResponse.redirect(makeRedirect("/login"));
  }

  const tokenHash = await hashToken(rawRefresh);
  const db = getDb();
  const now = new Date();

  const token = await db
    .select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.tokenHash, tokenHash),
      gt(refreshTokens.expiresAt, now),
    ))
    .get();

  if (!token) {
    const res = NextResponse.redirect(makeRedirect("/login"));
    clearAuthCookies(res);
    return res;
  }

  const user = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, token.userId))
    .get();

  if (!user) {
    const res = NextResponse.redirect(makeRedirect("/login"));
    clearAuthCookies(res);
    return res;
  }

  // Rotate: delete old token, issue new one
  await db.delete(refreshTokens).where(eq(refreshTokens.id, token.id));

  const newRaw = generateToken();
  const newHash = await hashToken(newRaw);
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: newHash,
    expiresAt,
    createdAt: now,
  });

  const secret = process.env.JWT_SECRET!;
  const sessionJwt = await signSessionJwt(
    { sub: user.id, email: user.email, role: user.role },
    secret,
  );

  const res = NextResponse.redirect(makeRedirect(next));
  setAuthCookies(res, sessionJwt, newRaw);
  return res;
}
