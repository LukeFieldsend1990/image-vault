import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeLicenceConsent } from "@/lib/consent/authorize";
import { revokeConsent, listConsentRecords } from "@/lib/compliance/consent";
import { loadConsentDocByLicence } from "@/lib/consent/load";
import { isUseCategoryId } from "@/lib/consent/use-categories";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/[id]/withdraw
// Withdraw consent for a licence. Body: { reason?: string, uses?: string[] }.
// Omitting `uses` withdraws every category consent on the licence.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const auth = await authorizeLicenceConsent(db, session, id);
  if (!auth) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  if (!auth.canAct) return NextResponse.json({ error: "Forbidden — only the performer or their agent can withdraw consent" }, { status: 403 });

  let body: { reason?: unknown; uses?: unknown } = {};
  try { const t = await req.text(); if (t) body = JSON.parse(t); } catch { /* tolerate empty body */ }
  const onlyUses = Array.isArray(body.uses)
    ? new Set(body.uses.filter((u): u is string => typeof u === "string"))
    : null;

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent");

  const records = await listConsentRecords(db, id);
  const withdrawn: string[] = [];
  for (const r of records) {
    if (r.status !== "granted") continue;
    if (r.language) continue; // category-level only here
    if (!isUseCategoryId(r.useType)) continue;
    if (onlyUses && !onlyUses.has(r.useType)) continue;
    await revokeConsent(db, { recordId: r.id, actorId: session.sub, ip, ua });
    withdrawn.push(r.useType);
  }

  void (async () => {
    try {
      const vm = await loadConsentDocByLicence(db, id);
      const licensee = await db.select({ email: users.email }).from(users).where(eq(users.id, auth.licence.licenseeId)).get();
      const performerName = vm?.performerName ?? "The performer";
      const productionName = vm?.productionName ?? "your production";
      await createNotification(db, {
        userId: auth.licence.licenseeId,
        type: "consent_withdrawn",
        title: `${performerName} withdrew consent`,
        body: `${withdrawn.length} use${withdrawn.length === 1 ? "" : "s"} withdrawn on ${productionName}.`,
        href: `/licences/${id}`,
      });
      void licensee; // notification is the primary channel; email withdrawal copy TBD with legal
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, withdrawn });
}
