export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeScope } from "@/lib/compliance/access";
import { generateCertificate, type CertBucket, type CertScope } from "@/lib/compliance/certificate";
import type { RegimeId } from "@/lib/compliance/types";

const SCOPES: CertScope[] = ["licence", "talent", "production", "organisation"];

// POST /api/compliance/certificates — generate a Compliance Certificate (the hero).
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { scope?: string; scopeId?: string; regime?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = body.scope as CertScope;
  const scopeId = typeof body.scopeId === "string" ? body.scopeId.trim() : "";
  if (!SCOPES.includes(scope) || !scopeId) {
    return NextResponse.json({ error: "scope (licence|talent|production|organisation) and scopeId are required" }, { status: 400 });
  }

  const db = getDb();
  const auth = await authorizeScope(db, session, scope, scopeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { env } = getRequestContext();
  const bucket = env.SCANS_BUCKET as unknown as CertBucket;

  const result = await generateCertificate(db, bucket, {
    scope,
    scopeId,
    regime: (body.regime as RegimeId) ?? "sag_aftra",
    generatedBy: session.sub,
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
