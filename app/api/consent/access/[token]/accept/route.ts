import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyConsentToken } from "@/lib/consent/token";
import { acceptConsentForCast } from "@/lib/consent/acceptance";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { consentConfirmedEmail } from "@/lib/email/templates";
import { listUseCategories } from "@/lib/consent/use-categories";

// POST /api/consent/access/[token]/accept
// PUBLIC — an unregistered performer confirms consent via the tokenised link.
// Body: { uses: string[], attested: true }. Records the document artifact and
// flips the cast row to `consented`; the ledger is written at registration.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await verifyConsentToken(token);
  if (!data) return NextResponse.json({ error: "This consent link is invalid or has expired." }, { status: 404 });

  let body: { uses?: unknown; attested?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.attested !== true) return NextResponse.json({ error: "You must confirm the attestation." }, { status: 400 });
  const uses = Array.isArray(body.uses) ? body.uses.filter((u): u is string => typeof u === "string") : [];

  const db = getDb();
  const cast = await db
    .select({ id: productionCast.id, status: productionCast.status, addedBy: productionCast.addedBy })
    .from(productionCast)
    .where(eq(productionCast.id, data.castId))
    .get();
  if (!cast) return NextResponse.json({ error: "This consent request no longer exists." }, { status: 404 });
  // Idempotency — a re-opened token / stale tab must not double-record consent.
  if (cast.status === "consented") return NextResponse.json({ ok: true, alreadyAccepted: true });

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent");

  const result = await acceptConsentForCast(db, {
    castId: data.castId,
    acceptedByEmail: data.email,
    uses,
    ip,
    ua,
  });

  void (async () => {
    try {
      const vm = await loadConsentDocByCast(db, data.castId);
      const coordinator = await db.select({ email: users.email }).from(users).where(eq(users.id, cast.addedBy)).get();
      const total = listUseCategories().length;
      const performerName = vm?.performerName ?? "The performer";
      const productionName = vm?.productionName ?? "your production";
      await createNotification(db, {
        userId: cast.addedBy,
        type: "consent_confirmed",
        title: `${performerName} confirmed consent`,
        body: `${uses.length} of ${total} uses consented on ${productionName}.`,
        href: `/productions/${data.productionId}#cast`,
      });
      if (coordinator?.email) {
        const { subject, html } = consentConfirmedEmail({
          recipientEmail: coordinator.email,
          performerName,
          productionName,
          consentedCount: uses.length,
          totalCount: total,
          reviewUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io"}/productions/${data.productionId}#cast`,
        });
        await sendEmail({ to: coordinator.email, subject, html });
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({ ok: true, ...result });
}
