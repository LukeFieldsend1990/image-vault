import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { buildUnderwritingView } from "@/lib/compliance/underwriting";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/insurer/productions/[id]
// The insurer's per-production underwriting dashboard (§4.2). Read-only; gated by
// an active insurer grant on this production (or admin).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const view = await buildUnderwritingView(db, id, regime);
  if (!view) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  return NextResponse.json(view);
}
