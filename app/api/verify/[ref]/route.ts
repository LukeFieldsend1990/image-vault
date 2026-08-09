import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifySealByRef } from "@/lib/compliance/seal";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";

/**
 * GET /api/verify/[ref] — public document verification. No session.
 *
 * The caller is whoever scanned the QR code on a printed record: opposing
 * counsel, an arbitrator, an insurer, a union rep. They already hold the
 * document, so they already know the names on it — but the URL on its own must
 * not disclose anything, because refs get forwarded, screenshotted, and pasted
 * into email threads.
 *
 * So the response carries only the integrity verdict and the two hashes to
 * compare. No names, no emails, no production titles, no event types, no
 * timestamps beyond issue and verification. `subjectLabel` is set at mint time
 * to initials plus a vault code and nothing else.
 *
 * Refs are 22 characters of ~128-bit entropy, so enumeration is not a practical
 * attack, but the endpoint is rate-limited anyway: it does real work (it reloads
 * and rehashes every chain in scope) and an unauthenticated endpoint that does
 * real work is worth a ceiling.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;

  const limit = await checkRateLimit(getClientIp(req), {
    action: "verify-seal",
    maxAttempts: 30,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many verification requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Cheap shape check before touching the database.
  if (!/^[A-Za-z0-9]{16,40}$/.test(ref)) {
    return NextResponse.json({ error: "Unknown document reference" }, { status: 404 });
  }

  const db = getDb();
  const verdict = await verifySealByRef(db, ref);

  if (!verdict) {
    return NextResponse.json({ error: "Unknown document reference" }, { status: 404 });
  }

  return NextResponse.json(verdict, {
    // A verdict is a point-in-time statement about live data — never cache it.
    headers: { "Cache-Control": "no-store" },
  });
}
