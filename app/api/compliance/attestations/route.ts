export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicence, authorizeProducer } from "@/lib/compliance/access";
import { recordAttestation, listAttestations, type AttestationType } from "@/lib/compliance/attestations";

const TYPES: AttestationType[] = ["biometric_isolation", "security_custody"];

const clientIp = (req: NextRequest) =>
  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null;

// POST /api/compliance/attestations — producer/admin records a 39.E / 39.H attestation.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { licenceId?: string; attestationType?: string; attestationText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const licenceId = typeof body.licenceId === "string" ? body.licenceId : "";
  const attestationType = body.attestationType as AttestationType;
  const attestationText = typeof body.attestationText === "string" ? body.attestationText.trim() : "";
  if (!licenceId || !TYPES.includes(attestationType) || !attestationText) {
    return NextResponse.json(
      { error: "licenceId, attestationType (biometric_isolation|security_custody) and attestationText are required" },
      { status: 400 },
    );
  }

  const db = getDb();
  const auth = await authorizeProducer(db, session, licenceId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await recordAttestation(db, {
    licenceId,
    organisationId: auth.licence.organisationId,
    attestationType,
    attestedBy: session.sub,
    attestationText,
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}

// GET /api/compliance/attestations?licenceId= — list (talent/rep/licensee/admin read).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const licenceId = new URL(req.url).searchParams.get("licenceId") ?? "";
  if (!licenceId) return NextResponse.json({ error: "licenceId is required" }, { status: 400 });

  const db = getDb();
  const auth = await authorizeLicence(db, session, licenceId, "read");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({ attestations: await listAttestations(db, licenceId) });
}
