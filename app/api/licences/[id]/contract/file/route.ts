import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import { licences, talentReps } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "contract.pdf";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned || "contract.pdf";
}

async function authorizeLicenceParty(
  db: ReturnType<typeof getDb>,
  licenceId: string,
  session: { sub: string; email: string; role: string },
) {
  const lic = await db
    .select({ id: licences.id, talentId: licences.talentId, licenseeId: licences.licenseeId, contractUrl: licences.contractUrl })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();
  if (!lic) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  if (isAdmin(session.email)) return { lic } as const;
  if (lic.talentId === session.sub || lic.licenseeId === session.sub) return { lic } as const;

  if (session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, lic.talentId)))
      .get();
    if (link) return { lic } as const;
  }
  return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
}

// POST /api/licences/[id]/contract/file — upload signed contract PDF
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceParty(db, id, session);
  if ("error" in auth) return auth.error;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data body required" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 20 MB limit" }, { status: 413 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only application/pdf is accepted" }, { status: 415 });
  }

  const filename = sanitizeFilename(file.name);
  const key = `contracts/${id}/${filename}`;

  const { env } = getCloudflareContext();
  await env.SCANS_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/pdf" },
  });

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(licences)
    .set({ contractUrl: key, contractUploadedAt: now, contractUploadedBy: session.sub })
    .where(eq(licences.id, id));

  return NextResponse.json({ contractUrl: key, filename, uploadedAt: now });
}

// GET /api/licences/[id]/contract/file — stream signed contract PDF from R2
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceParty(db, id, session);
  if ("error" in auth) return auth.error;
  const { lic } = auth;

  if (!lic.contractUrl) {
    return NextResponse.json({ error: "No contract uploaded" }, { status: 404 });
  }

  const { env } = getCloudflareContext();
  const obj = await env.SCANS_BUCKET.get(lic.contractUrl);
  if (!obj) {
    return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
  }

  const filename = lic.contractUrl.split("/").pop() ?? "contract.pdf";
  const encoded = encodeURIComponent(filename);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}
