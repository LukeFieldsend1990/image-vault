import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { fetchRecentActingCredits } from "@/lib/calculator/tmdb";
import { DEFAULT_ASSUMPTIONS } from "@/lib/calculator/model";

const MAX_LOOKBACK_YEARS = 25;

/**
 * Public credit lookup for the /calculator applet — no session, no storage.
 * Returns a person's acting credits over the lookback window, newest first.
 */
export async function GET(req: NextRequest) {
  const limit = await checkRateLimit(getClientIp(req), {
    action: "calculator-credits",
    maxAttempts: 30,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many lookups. Give it a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const personIdRaw = req.nextUrl.searchParams.get("personId");
  const personId = Number(personIdRaw);
  if (!personIdRaw || !Number.isInteger(personId) || personId <= 0) {
    return NextResponse.json({ error: "Pick a name from the list first." }, { status: 400 });
  }

  const yearsRaw = req.nextUrl.searchParams.get("years");
  const parsedYears = Number(yearsRaw);
  const years =
    yearsRaw && Number.isInteger(parsedYears) && parsedYears > 0
      ? Math.min(parsedYears, MAX_LOOKBACK_YEARS)
      : DEFAULT_ASSUMPTIONS.lookbackYears;

  const result = await fetchRecentActingCredits(personId, years);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ...result.data, lookbackYears: years });
}
