export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, totpCredentials } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { eq } from "drizzle-orm";

type PreauthOption = "7d" | "14d" | "30d" | "licence";

// POST /api/licences/[id]/preauth/confirm — talent confirms a rep-initiated preauth request with their TOTP
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only the talent can confirm a pre-auth request" }, { status: 403 });
  }

  let body: { code?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }
  if (!body.code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const db = getDb();
  const kv = getKv();

  // Verify the licence belongs to this talent
  const row = await db
    .select({ talentId: licences.talentId, permitAiTraining: licences.permitAiTraining, validTo: licences.validTo, status: licences.status })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (row.talentId !== session.sub) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (row.permitAiTraining) return NextResponse.json({ error: "Pre-auth not available for AI training licences" }, { status: 409 });

  // Check pending request
  const pending = await kv.get(`preauth_req:${id}`, "json") as { requestedBy: string; option: PreauthOption } | null;
  if (!pending) return NextResponse.json({ error: "No pending pre-auth request found" }, { status: 404 });

  // Verify talent TOTP
  const [totp] = await db
    .select({ secret: totpCredentials.secret })
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, session.sub))
    .limit(1)
    .all();

  if (!totp) return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
  if (!verifyTotpCode(totp.secret, body.code)) return NextResponse.json({ error: "Invalid code" }, { status: 401 });

  const now = Math.floor(Date.now() / 1000);
  let preauthUntil: number;
  if (pending.option === "7d")       preauthUntil = now + 7  * 86400;
  else if (pending.option === "14d") preauthUntil = now + 14 * 86400;
  else if (pending.option === "30d") preauthUntil = now + 30 * 86400;
  else                               preauthUntil = row.validTo; // "licence"

  await db.update(licences).set({ preauthUntil, preauthSetBy: session.sub }).where(eq(licences.id, id));
  await kv.delete(`preauth_req:${id}`);

  return NextResponse.json({ ok: true, preauthUntil });
}
