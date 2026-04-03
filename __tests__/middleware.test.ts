import { describe, it, expect, vi, beforeEach } from "vitest";
import { signSessionJwt } from "@/lib/auth/jwt";

const JWT_SECRET = "test-middleware-secret";

// Mock process.env before importing middleware
vi.stubEnv("JWT_SECRET", JWT_SECRET);

// We test the middleware logic by importing it after setting env
const { middleware } = await import("@/middleware");

function makeRequest(path: string, opts?: { sessionToken?: string; refreshToken?: string; prefetch?: boolean }) {
  const url = new URL(path, "http://localhost:3000");
  const headers = new Headers();
  if (opts?.prefetch) {
    headers.set("Next-Router-Prefetch", "1");
  }
  const cookies: string[] = [];
  if (opts?.sessionToken) cookies.push(`session=${opts.sessionToken}`);
  if (opts?.refreshToken) cookies.push(`refresh=${opts.refreshToken}`);
  if (cookies.length) headers.set("Cookie", cookies.join("; "));

  // Minimal NextRequest-like object
  return new Request(url.toString(), { headers });
}

// Helper to create a NextRequest from a plain Request
async function callMiddleware(path: string, opts?: Parameters<typeof makeRequest>[1]) {
  const req = makeRequest(path, opts);
  // NextRequest wraps Request — middleware expects NextRequest
  const { NextRequest } = await import("next/server");
  const nextReq = new NextRequest(req);
  return middleware(nextReq);
}

describe("middleware", () => {
  it("allows unprotected routes through", async () => {
    const res = await callMiddleware("/");
    // NextResponse.next() doesn't redirect
    expect(res.status).not.toBe(302);
  });

  it("redirects unauthenticated users on protected routes to /login", async () => {
    const res = await callMiddleware("/dashboard");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("Location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("redirects to /api/auth/refresh when session expired but refresh cookie exists", async () => {
    const res = await callMiddleware("/dashboard", { refreshToken: "some-refresh" });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("Location")!);
    expect(location.pathname).toBe("/api/auth/refresh");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("allows access with valid session token", async () => {
    const token = await signSessionJwt(
      { sub: "u1", email: "test@test.com", role: "talent" },
      JWT_SECRET
    );
    const res = await callMiddleware("/dashboard", { sessionToken: token });
    // Should not redirect
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(302);
  });

  it("redirects authenticated users away from auth pages to /dashboard", async () => {
    const token = await signSessionJwt(
      { sub: "u1", email: "test@test.com", role: "talent" },
      JWT_SECRET
    );
    const res = await callMiddleware("/login", { sessionToken: token });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("Location")!);
    expect(location.pathname).toBe("/dashboard");
  });

  it("blocks non-admin users from /admin", async () => {
    const token = await signSessionJwt(
      { sub: "u1", email: "regular@test.com", role: "talent" },
      JWT_SECRET
    );
    const res = await callMiddleware("/admin", { sessionToken: token });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("Location")!);
    expect(location.pathname).toBe("/dashboard");
  });

  it("allows whitelisted admin emails to access /admin", async () => {
    const token = await signSessionJwt(
      { sub: "u1", email: "lukefieldsend@googlemail.com", role: "admin" },
      JWT_SECRET
    );
    const res = await callMiddleware("/admin", { sessionToken: token });
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(302);
  });

  it("returns 401 for prefetch on protected routes without auth", async () => {
    const res = await callMiddleware("/dashboard", { prefetch: true });
    expect(res.status).toBe(401);
  });
});
