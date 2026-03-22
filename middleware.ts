import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED = ["/dashboard", "/licences", "/audit", "/settings", "/directory", "/talent", "/vault/requests", "/vault/licences", "/vault/authorise", "/vault/monitor", "/roster", "/onboarding", "/admin"];
const AUTH_PAGES = ["/login", "/signup", "/setup-2fa"];
const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

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

function getEmailFromToken(req: NextRequest): string | null {
  try {
    const token = req.cookies.get("session")?.value;
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1])) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  if (isProtected || isAuthPage) {
    const status = await getAuthStatus(req);

    // Admin whitelist — must be authenticated AND email must be in ADMIN_EMAILS
    if (pathname.startsWith("/admin")) {
      if (status !== "ok") {
        const loginUrl = req.nextUrl.clone();
        loginUrl.pathname = "/login";
        loginUrl.search = "";
        loginUrl.searchParams.set("next", pathname);
        return NextResponse.redirect(loginUrl);
      }
      const email = getEmailFromToken(req);
      if (!email || !ADMIN_EMAILS.includes(email)) {
        const dashUrl = req.nextUrl.clone();
        dashUrl.pathname = "/dashboard";
        dashUrl.search = "";
        return NextResponse.redirect(dashUrl);
      }
      return NextResponse.next();
    }

    // Don't do auth redirects for Next.js prefetch requests — they race with actual
    // navigation and can consume the refresh token before the real request arrives.
    const isPrefetch =
      req.headers.get("Next-Router-Prefetch") === "1" ||
      req.headers.get("Purpose") === "prefetch";

    if (isProtected && status === "none") {
      if (isPrefetch) return new NextResponse(null, { status: 401 });
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isProtected && status === "refresh") {
      if (isPrefetch) return new NextResponse(null, { status: 401 });
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
    "/admin/:path*",
    "/login",
    "/signup",
    "/setup-2fa",
  ],
};
