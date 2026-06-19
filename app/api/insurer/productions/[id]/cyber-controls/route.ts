import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { buildCyberControls } from "@/lib/compliance/cyber-controls";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/insurer/productions/[id]/cyber-controls
// SOC2-lite cyber-underwriting controls (§4.6) for one production. Read-only;
// gated by an active insurer grant on this production (or admin).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const view = await buildCyberControls(db, id, regime);
  return NextResponse.json(view);
}
