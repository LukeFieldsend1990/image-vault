import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { resolveInsurerAccess } from "@/lib/compliance/insurer-access";
import { buildEvidencePack } from "@/lib/compliance/evidence-pack";
import { generateCertificate, type CertBucket } from "@/lib/compliance/certificate";
import type { RegimeId } from "@/lib/compliance/types";

// GET /api/insurer/productions/[id]/evidence-pack
// Machine-readable claims evidence pack (§4.3): consent ledger, custody chain,
// downloads, Bridge tamper log + a recomputed tamper-seal verification. Served as a
// downloadable JSON attachment for actuarial ingest / counsel hand-off.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  const regime = (new URL(req.url).searchParams.get("regime") as RegimeId) ?? "sag_aftra";
  const pack = await buildEvidencePack(db, id, regime);
  if (!pack) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const filename = `claims-evidence-${pack.production.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${pack.generatedAt}.json`;
  return new NextResponse(JSON.stringify(pack, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// POST /api/insurer/productions/[id]/evidence-pack
// Generate the signed, printable HTML certificate (the counsel-friendly twin of the
// JSON pack) for this production, sealed with the ledger tip hash. Returns its URL.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const access = await resolveInsurerAccess(db, session, id);
  if (!access.allowed) return NextResponse.json({ error: "No insurer grant for this production" }, { status: 403 });

  let regime: RegimeId = "sag_aftra";
  try {
    const body = (await req.json()) as { regime?: string };
    if (typeof body.regime === "string") regime = body.regime as RegimeId;
  } catch {
    // empty body is fine — default regime
  }

  const { env } = getCloudflareContext();
  const bucket = env.SCANS_BUCKET as unknown as CertBucket;

  const result = await generateCertificate(db, bucket, {
    scope: "production",
    scopeId: id,
    regime,
    generatedBy: session.sub,
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
