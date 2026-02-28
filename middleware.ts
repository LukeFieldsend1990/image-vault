import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED = ["/dashboard", "/licences", "/audit", "/settings", "/directory", "/talent", "/vault/requests", "/vault/licences", "/vault/authorise", "/vault/monitor", "/roster", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup", "/setup-2fa"];

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

type AuthStatus = "ok" | "refresh" | "none";

async function getAuthStatus(req: NextRequest): Promise<AuthStatus> {
  const token = req.cookies.get("session")?.value;
  const hasRefresh = !!req.cookies.get("refresh")?.value;

  if (!token) return hasRefresh ? "refresh" : "none";

  try {
    await jwtVerify(token, getSecret(), {
      issuer: "image-vault",
      audience: "image-vault-app",
    });
    return "ok";
  } catch {
    return hasRefresh ? "refresh" : "none";
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (isProtected || isAuthPage) {
    const status = await getAuthStatus(req);

    if (isProtected && status === "none") {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isProtected && status === "refresh") {
      const refreshUrl = req.nextUrl.clone();
      refreshUrl.pathname = "/api/auth/refresh";
      refreshUrl.search = "";
      refreshUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(refreshUrl);
    }

    if (isAuthPage && status === "ok") {
      const dashUrl = req.nextUrl.clone();
      dashUrl.pathname = "/dashboard";
      dashUrl.search = "";
      return NextResponse.redirect(dashUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/licences/:path*",
    "/audit/:path*",
    "/settings/:path*",
    "/directory/:path*",
    "/talent/:path*",
    "/vault/requests/:path*",
    "/vault/licences/:path*",
    "/vault/authorise/:path*",
    "/vault/monitor/:path*",
    "/roster/:path*",
    "/onboarding",
    "/login",
    "/signup",
    "/setup-2fa",
  ],
};
