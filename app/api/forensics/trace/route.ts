import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { trace, type TraceMatch, type TraceResult } from "@/lib/forensics/trace";

/**
 * POST /api/forensics/trace
 * Body: { query: string }  — a SHA-256 file digest, or watermark payload hex.
 *
 * Authorisation is resolved *after* matching, because the caller by definition
 * does not know whose file it is yet — that is the question. So: run the match,
 * then filter the results down to files the caller is entitled to see. An admin
 * sees everything; a performer sees their own scans; a rep sees the scans of
 * talent they represent. A licensee sees nothing here — knowing that a hash
 * belongs to another performer's scan is not theirs to learn.
 *
 * Filtering after the fact means an unauthorised caller gets an empty result
 * rather than a 403, so the endpoint cannot be used as an oracle for "does this
 * hash exist on the platform".
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // The fingerprint prefix path can scan the fingerprint table, so this is not a
  // free query. Bounded per caller.
  const limit = await checkRateLimit(getClientIp(req), {
    action: "forensics-trace",
    maxAttempts: 20,
    windowSeconds: 60,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many trace requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { query?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "A hash or fingerprint is required" }, { status: 400 });
  if (query.length > 200) return NextResponse.json({ error: "Query is too long" }, { status: 400 });

  const db = getDb();
  const result = await trace(db, query);

  const admin = isAdmin(session.email);
  const visible: TraceMatch[] = [];
  for (const m of result.matches) {
    if (admin || m.file.talentId === session.sub) {
      visible.push(m);
      continue;
    }
    if (session.role === "rep" && (await hasRepAccess(session.sub, m.file.talentId))) {
      visible.push(m);
    }
  }

  const filtered = visible.length !== result.matches.length;
  const response: TraceResult = {
    ...result,
    matches: visible,
    // Never reveal that a match existed but was withheld — that would leak the
    // existence of another performer's file.
    conclusion:
      filtered && visible.length === 0
        ? "No file you have access to matches that value."
        : result.conclusion,
  };

  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
