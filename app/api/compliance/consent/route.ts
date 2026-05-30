export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicence } from "@/lib/compliance/access";
import {
  grantConsent,
  revokeConsent,
  listConsentRecords,
  listConsentEvents,
} from "@/lib/compliance/consent";
import { consentRecords } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface GrantBody {
  licenceId?: string;
  useType?: string;
  territory?: string;
  language?: string;
  validFrom?: number;
  validTo?: number;
  scriptedAlterations?: boolean;
}

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// POST /api/compliance/consent — talent/rep grants consent (39.B; 39.D if language set).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: GrantBody;
  try {
    body = (await req.json()) as GrantBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const licenceId = typeof body.licenceId === "string" ? body.licenceId : "";
  const useType = typeof body.useType === "string" ? body.useType.trim() : "";
  if (!licenceId || !useType) {
    return NextResponse.json({ error: "licenceId and useType are required" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authorizeLicence(db, session, licenceId, "write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await grantConsent({
    db,
    licenceId,
    talentId: auth.licence.talentId,
    actorId: session.sub,
    useType,
    territory: body.territory ?? null,
    language: body.language ?? null,
    validFrom: Number.isFinite(Number(body.validFrom)) ? Math.floor(Number(body.validFrom)) : null,
    validTo: Number.isFinite(Number(body.validTo)) ? Math.floor(Number(body.validTo)) : null,
    scriptedAlterations: body.scriptedAlterations === true,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}

// DELETE /api/compliance/consent — talent/rep revokes a consent record.
export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { recordId?: string };
  try {
    body = (await req.json()) as { recordId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const recordId = typeof body.recordId === "string" ? body.recordId : "";
  if (!recordId) return NextResponse.json({ error: "recordId is required" }, { status: 400 });

  const db = getDb();
  const rec = await db
    .select({ licenceId: consentRecords.licenceId })
    .from(consentRecords)
    .where(eq(consentRecords.id, recordId))
    .get();
  if (!rec) return NextResponse.json({ error: "Consent record not found" }, { status: 404 });

  const auth = await authorizeLicence(db, session, rec.licenceId, "write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await revokeConsent(db, {
    recordId,
    actorId: session.sub,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });
  if (!result) return NextResponse.json({ error: "Consent is not active" }, { status: 409 });

  return NextResponse.json({ ok: true, ...result });
}

// GET /api/compliance/consent?licenceId= — current state + history (talent/rep/licensee/admin).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const licenceId = new URL(req.url).searchParams.get("licenceId") ?? "";
  if (!licenceId) return NextResponse.json({ error: "licenceId is required" }, { status: 400 });

  const db = getDb();
  const auth = await authorizeLicence(db, session, licenceId, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [records, events] = await Promise.all([
    listConsentRecords(db, licenceId),
    listConsentEvents(db, licenceId),
  ]);

  return NextResponse.json({ records, events });
}
