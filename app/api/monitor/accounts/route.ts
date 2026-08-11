import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { listOffenderAccounts } from "@/lib/monitor/accounts";

// GET /api/monitor/accounts — offender case files for the session talent,
// reach-ranked. Only accounts that have hit this talent are returned.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can view offender accounts" }, { status: 403 });
  }

  const db = getDb();
  const accounts = await listOffenderAccounts(db, session.sub);
  return NextResponse.json({ accounts });
}
