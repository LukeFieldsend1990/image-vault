import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/rsl/profile";

/**
 * robots.txt with an RSL `License:` directive pointing at the platform-level
 * license policy. Per-talent consent profiles are unlisted (/c/ is disallowed
 * and noindexed); the License directive carries no PII.
 */
export function GET() {
  const base = baseUrl();
  const body = [
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /c/",
    "Allow: /api/rsl/",
    "",
    "# Really Simple Licensing (RSL) — machine-readable licensing terms.",
    `License: ${base}/.well-known/rsl.xml`,
    "",
  ].join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
