import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getScanStatus } from "@/lib/monitor/scan";

// GET /api/monitor/scans/:id — poll target for an in-flight sweep.
// Talent-only and scoped to the caller: a scan id is not an access grant.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can view likeness scans" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const scan = await getScanStatus(db, id, session.sub);
  if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });

  return NextResponse.json(scan);
}
