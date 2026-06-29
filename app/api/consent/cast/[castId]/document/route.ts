import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent } from "@/lib/consent/authorize";
import { loadConsentDocByCast } from "@/lib/consent/load";

// GET /api/consent/cast/[castId]/document
// The actionable cast-level consent document for a production-held placeholder.
// The reserved rep (talent side) and the production both load it to pre-negotiate
// the §39 scope before the performer is sent the final consent link. Mirrors the
// licence document endpoint's response shape so the shared client can render it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeCastConsent(db, session, castId);
  if (!auth) return NextResponse.json({ error: "This reserved role no longer exists." }, { status: 404 });
  if (!auth.canView) return NextResponse.json({ error: "This role is not assigned to you." }, { status: 403 });

  const vm = await loadConsentDocByCast(db, castId);
  if (!vm) return NextResponse.json({ error: "This consent document is not available." }, { status: 404 });

  return NextResponse.json({
    document: vm,
    canAct: auth.canAct,
    actingRole: auth.actingRole,
  });
}
