import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyConsentToken } from "@/lib/consent/token";
import { loadConsentDocByCast } from "@/lib/consent/load";

// GET /api/consent/access/[token]
// PUBLIC — resolve a tokenised consent link for an unregistered production-held
// performer and return the consent-document view-model. No session required.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await verifyConsentToken(token);
  if (!data) return NextResponse.json({ error: "This consent link is invalid or has expired." }, { status: 404 });

  const db = getDb();
  const vm = await loadConsentDocByCast(db, data.castId);
  if (!vm) return NextResponse.json({ error: "This consent request no longer exists." }, { status: 404 });

  return NextResponse.json({ document: vm, canAct: !vm.alreadyAccepted });
}
