import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { ADMIN_EMAILS } from "@/lib/auth/adminEmails";

const PROTECTED = ["/dashboard", "/licences", "/audit", "/settings", "/directory", "/talent", "/vault/requests", "/vault/licences", "/vault/authorise", "/vault/monitor", "/roster", "/onboarding", "/admin", "/inbox"];
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

function getTokenPayload(req: NextRequest): { email: string | null; role: string | null } {
  try {
    const token = req.cookies.get("session")?.value;
    if (!token) return { email: null, role: null };
    const payload = JSON.parse(atob(token.split(".")[1])) as { email?: string; role?: string };
    return { email: payload.email ?? null, role: payload.role ?? null };
  } catch {
    return { email: null, role: null };
  }
}

// Routes each role is allowed to access
const ROLE_ALLOWED_PREFIXES: Record<string, string[]> = {
  talent: ["/dashboard", "/vault", "/licences", "/settings", "/onboarding", "/inbox", "/bookings"],
  rep: ["/roster", "/vault/requests", "/vault/licences", "/vault/authorise", "/settings", "/inbox", "/licences"],
  licensee: ["/directory", "/talent", "/licences", "/settings", "/inbox"],
};

// Default landing page per role (for redirecting on denied access)
const ROLE_HOME: Record<string, string> = {
  talent: "/dashboard",
  rep: "/roster",
  licensee: "/directory",
};

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
      const { email } = getTokenPayload(req);
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
      const { role } = getTokenPayload(req);
      const dashUrl = req.nextUrl.clone();
      dashUrl.pathname = ROLE_HOME[role ?? "talent"] ?? "/dashboard";
      dashUrl.search = "";
      return NextResponse.redirect(dashUrl);
    }

    // Role-based route protection — redirect to role home if accessing a disallowed route
    if (isProtected && status === "ok") {
      const { role } = getTokenPayload(req);
      if (role && role !== "admin") {
        const allowed = ROLE_ALLOWED_PREFIXES[role];
        if (allowed && !allowed.some((prefix) => pathname.startsWith(prefix))) {
          const homeUrl = req.nextUrl.clone();
          homeUrl.pathname = ROLE_HOME[role] ?? "/dashboard";
          homeUrl.search = "";
          return NextResponse.redirect(homeUrl);
        }
      }
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
    "/inbox/:path*",
    "/login",
    "/signup",
    "/setup-2fa",
  ],
};
