import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { loadConsentDocByCast } from "@/lib/consent/load";

// GET /api/consent/preview/[castId]
// Read-only preview of the consent document a reserved-role placeholder will send
// once resolved. Lets the assigned agent (Path C) review the production detail and
// requested §39 scope *before* attaching their client's email. No acceptance is
// possible — `canAct` is always false. Auth: the rep assigned to the slot, or admin.
export async function GET(req: NextRequest, { params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const cast = await db
    .select({ id: productionCast.id, repId: productionCast.repId })
    .from(productionCast)
    .where(eq(productionCast.id, castId))
    .get();
  if (!cast) return NextResponse.json({ error: "This reserved role no longer exists." }, { status: 404 });

  if (!isAdmin(session.email) && cast.repId !== session.sub) {
    return NextResponse.json({ error: "This role is not assigned to you." }, { status: 403 });
  }

  const vm = await loadConsentDocByCast(db, castId);
  if (!vm) return NextResponse.json({ error: "This consent document is not available." }, { status: 404 });

  return NextResponse.json({ document: vm, canAct: false, preview: true });
}
