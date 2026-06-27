import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { loadConsentDocByLicence } from "@/lib/consent/load";

// GET /api/consent/[id]/document
// Returns the consent-document view-model for a licence. Auth: the talent who
// owns it, their rep/agent, the licensee, or an admin.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.canView) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const vm = await loadConsentDocByLicence(db, id);
  if (!vm) return NextResponse.json({ error: "Licence not found" }, { status: 404 });

  return NextResponse.json({ document: vm, canAct: auth.canAct, actingRole: auth.actingRole });
}
