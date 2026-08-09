import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { searchPeople } from "@/lib/calculator/tmdb";

/**
 * Public person search for the /calculator applet — no session, no storage.
 *
 * This is the one unauthenticated door onto TMDB, so it is rate-limited per IP
 * to keep the shared API key from being used as a free search backend.
 */
export async function GET(req: NextRequest) {
  const limit = await checkRateLimit(getClientIp(req), {
    action: "calculator-search",
    maxAttempts: 40,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many searches. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Type at least two characters." }, { status: 400 });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: "That name is too long." }, { status: 400 });
  }

  const result = await searchPeople(q);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ people: result.data });
}
