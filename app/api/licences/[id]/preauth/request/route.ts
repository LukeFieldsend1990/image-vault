export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getKv } from "@/lib/db";
import { licences, talentReps, users, scanPackages } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";

type PreauthOption = "7d" | "14d" | "30d" | "licence";

const OPTION_LABELS: Record<PreauthOption, string> = {
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
  "licence": "the full licence period",
};

// GET /api/licences/[id]/preauth/request — return pending rep preauth request if any
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const row = await db
    .select({ talentId: licences.talentId })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.talentId !== session.sub && session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kv = getKv();
  const pending = await kv.get(`preauth_req:${id}`, "json") as {
    requestedBy: string;
    repEmail: string;
    option: PreauthOption;
    requestedAt: number;
  } | null;

  return NextResponse.json({ pending });
}

// POST /api/licences/[id]/preauth/request — rep creates a pending preauth request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "rep") {
    return NextResponse.json({ error: "Only reps can request pre-authorisation on behalf of talent" }, { status: 403 });
  }

  let body: { option?: PreauthOption } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const validOptions: PreauthOption[] = ["7d", "14d", "30d", "licence"];
  if (!body.option || !validOptions.includes(body.option)) {
    return NextResponse.json({ error: "option must be one of: 7d, 14d, 30d, licence" }, { status: 400 });
  }

  const db = getDb();

  // Verify this rep represents the talent on this licence
  const row = await db
    .select({ talentId: licences.talentId, projectName: licences.projectName, packageId: licences.packageId, permitAiTraining: licences.permitAiTraining, status: licences.status })
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!row) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (row.status !== "APPROVED") return NextResponse.json({ error: "Licence is not approved" }, { status: 409 });
  if (!row.packageId) return NextResponse.json({ error: "Licence has no package attached" }, { status: 409 });
  if (row.permitAiTraining) return NextResponse.json({ error: "Pre-auth cannot be requested for AI training licences" }, { status: 409 });
  const rowPackageId = row.packageId;

  const repLink = await db
    .select({ id: talentReps.id })
    .from(talentReps)
    .where(eq(talentReps.repId, session.sub))
    .get();

  if (!repLink) return NextResponse.json({ error: "You do not represent this talent" }, { status: 403 });

  const now = Math.floor(Date.now() / 1000);

  // Store in KV — 24h TTL
  const kv = getKv();
  const repUser = await db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get();
  await kv.put(`preauth_req:${id}`, JSON.stringify({
    requestedBy: session.sub,
    repEmail: repUser?.email ?? session.email,
    option: body.option,
    requestedAt: now,
  }), { expirationTtl: 86400 });

  // Email the talent
  void (async () => {
    const [talentUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, row.talentId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, rowPackageId)).get(),
    ]);
    if (!talentUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const periodLabel = OPTION_LABELS[body.option!];
    await sendEmail({
      to: talentUser.email,
      subject: `Pre-auth request for ${row.projectName}`,
      html: `
        <p>Your rep (${repUser?.email ?? "your rep"}) has requested pre-authorisation for <strong>${row.projectName}</strong> (${pkg?.name ?? rowPackageId}).</p>
        <p>This would allow the licensee to download your scan package for <strong>${periodLabel}</strong> without requiring your 2FA code each time.</p>
        <p><a href="${baseUrl}/vault/authorise/${id}?confirm_preauth=1">Review and confirm</a></p>
        <p>If you did not expect this request, you can ignore it — it will expire in 24 hours.</p>
      `,
    });
  })();

  return NextResponse.json({ ok: true });
}
