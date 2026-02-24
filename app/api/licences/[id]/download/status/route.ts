export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
import type { DualCustodySession } from "../initiate/route";

// GET /api/licences/[id]/download/status — poll for dual-custody session state
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const kv = getKv();

  const [licence] = await db
    .select({ talentId: licences.talentId, licenseeId: licences.licenseeId })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only parties to the licence can poll
  if (licence.licenseeId !== session.sub && licence.talentId !== session.sub && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dcSession = await kv.get(`dual_custody:${id}`, "json") as DualCustodySession | null;
  if (!dcSession) {
    return NextResponse.json({ step: null });
  }

  const now = Math.floor(Date.now() / 1000);
  if (dcSession.expiresAt < now) {
    return NextResponse.json({ step: "expired" });
  }

  if (dcSession.step === "complete") {
    return NextResponse.json({ step: "complete", downloadTokens: dcSession.downloadTokens });
  }

  return NextResponse.json({ step: dcSession.step });
}
