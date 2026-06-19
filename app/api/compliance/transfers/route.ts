import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicence, authorizeProducer } from "@/lib/compliance/access";
import { requestTransfer, listTransfers } from "@/lib/compliance/transfers";

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// POST /api/compliance/transfers — producer requests a third-party transfer (39.I).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { licenceId?: string; toPartyName?: string; toPartyDetails?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const licenceId = typeof body.licenceId === "string" ? body.licenceId : "";
  const toPartyName = typeof body.toPartyName === "string" ? body.toPartyName.trim() : "";
  if (!licenceId || !toPartyName) {
    return NextResponse.json({ error: "licenceId and toPartyName are required" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authorizeProducer(db, session, licenceId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await requestTransfer(db, {
    licenceId,
    fromOrganisationId: auth.licence.organisationId,
    toPartyName,
    toPartyDetails: body.toPartyDetails,
    requestedBy: session.sub,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}

// GET /api/compliance/transfers?licenceId= — list transfers (talent/rep/licensee/admin read).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const licenceId = new URL(req.url).searchParams.get("licenceId") ?? "";
  if (!licenceId) return NextResponse.json({ error: "licenceId is required" }, { status: 400 });

  const db = getDb();
  const auth = await authorizeLicence(db, session, licenceId, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({ transfers: await listTransfers(db, licenceId) });
}
