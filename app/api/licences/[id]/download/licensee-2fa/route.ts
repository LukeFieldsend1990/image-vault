export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { totpCredentials, users, licences, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { verifyTotpCode } from "@/lib/auth/totp";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { downloadRequestEmail } from "@/lib/email/templates";
import type { DualCustodySession } from "../initiate/route";

// POST /api/licences/[id]/download/licensee-2fa
// Licensee completes their TOTP challenge — advances flow to awaiting_talent
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "licensee") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { code?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (!body.code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const kv = getKv();
  const now = Math.floor(Date.now() / 1000);

  const dcSession = await kv.get(`dual_custody:${id}`, "json") as DualCustodySession | null;
  if (!dcSession || dcSession.expiresAt < now) {
    return NextResponse.json({ error: "No active download session — please initiate again" }, { status: 409 });
  }
  if (dcSession.licenseeId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (dcSession.step !== "awaiting_licensee") {
    return NextResponse.json({ step: dcSession.step });
  }

  // Verify licensee TOTP
  const db = getDb();
  const [totp] = await db
    .select({ secret: totpCredentials.secret })
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, session.sub))
    .limit(1)
    .all();

  if (!totp) {
    return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
  }

  if (!verifyTotpCode(totp.secret, body.code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const updated: DualCustodySession = { ...dcSession, step: "awaiting_talent" };
  const ttl = dcSession.expiresAt - now;
  await kv.put(`dual_custody:${id}`, JSON.stringify(updated), { expirationTtl: ttl });

  // Notify talent/rep that their authorisation is required (fire-and-forget)
  void (async () => {
    const db = getDb();
    const [talentUser, licenseeUser, licenceRow, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.talentId)).get(),
      db.select({ email: users.email }).from(users).where(eq(users.id, dcSession.licenseeId)).get(),
      db.select({ projectName: licences.projectName }).from(licences).where(eq(licences.id, id)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, dcSession.packageId)).get(),
    ]);
    if (!talentUser?.email || !licenceRow || !pkg) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = downloadRequestEmail({
      talentEmail: talentUser.email,
      licenseeEmail: licenseeUser?.email ?? "Unknown",
      projectName: licenceRow.projectName,
      packageName: pkg.name,
      authoriseUrl: `${baseUrl}/vault/authorise/${id}`,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ step: "awaiting_talent" });
}
