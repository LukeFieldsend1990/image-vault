export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeScope } from "@/lib/compliance/access";
import { complianceCertificates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { CertScope } from "@/lib/compliance/certificate";

// GET /api/compliance/certificates/:id — the rendered HTML doc (or ?meta=1 for JSON).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const cert = await db
    .select()
    .from(complianceCertificates)
    .where(eq(complianceCertificates.id, id))
    .get();
  if (!cert) return NextResponse.json({ error: "Certificate not found" }, { status: 404 });

  const auth = await authorizeScope(db, session, cert.scope as CertScope, cert.scopeId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (new URL(req.url).searchParams.get("meta") === "1") {
    return NextResponse.json({
      id: cert.id,
      scope: cert.scope,
      scopeId: cert.scopeId,
      regime: cert.regime,
      ledgerTipHash: cert.ledgerTipHash,
      obligations: safeParse(cert.obligationsJson),
      eventCount: cert.eventCount,
      generatedAt: cert.generatedAt,
    });
  }

  const { env } = getRequestContext();
  const obj = await (env.SCANS_BUCKET as unknown as { get(k: string): Promise<{ text(): Promise<string> } | null> }).get(cert.r2Key);
  if (!obj) return NextResponse.json({ error: "Certificate document not found" }, { status: 404 });
  const html = await obj.text();
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
