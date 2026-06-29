import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productionCast, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyConsentToken } from "@/lib/consent/token";
import { loadConsentDocByCast } from "@/lib/consent/load";
import { createNotification } from "@/lib/notifications/create";

// POST /api/consent/access/[token]/custody
// PUBLIC — after confirming consent via the tokenised link, the performer records
// their custody election. Body: { choice: "self" | "rep_managed" }.
//  - "self": informational; they will register and take ownership of the vault.
//  - "rep_managed": they leave the row production-held, managed by their rep. The
//    production stays the GDPR data controller and holds the scan — recording the
//    choice does NOT transfer ownership.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await verifyConsentToken(token);
  if (!data) return NextResponse.json({ error: "This consent link is invalid or has expired." }, { status: 404 });

  let body: { choice?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const choice = body.choice === "self" || body.choice === "rep_managed" ? body.choice : null;
  if (!choice) return NextResponse.json({ error: "Invalid custody choice." }, { status: 400 });

  const db = getDb();
  const cast = await db
    .select({ id: productionCast.id, repId: productionCast.repId, talentId: productionCast.talentId })
    .from(productionCast)
    .where(eq(productionCast.id, data.castId))
    .get();
  if (!cast) return NextResponse.json({ error: "This consent request no longer exists." }, { status: 404 });
  if (cast.talentId) return NextResponse.json({ error: "This vault has already been claimed." }, { status: 409 });

  await db
    .update(productionCast)
    .set({ custodyChoice: choice, custodyChosenAt: Math.floor(Date.now() / 1000) })
    .where(eq(productionCast.id, data.castId));

  // Let the rep know their client chose to keep the role under their management.
  if (choice === "rep_managed" && cast.repId) {
    void (async () => {
      try {
        const vm = await loadConsentDocByCast(db, data.castId);
        const performerName = vm?.performerName ?? "Your client";
        const productionName = vm?.productionName ?? "the production";
        const rep = await db.select({ id: users.id }).from(users).where(eq(users.id, cast.repId!)).get();
        if (rep) {
          await createNotification(db, {
            userId: rep.id,
            type: "consent_confirmed",
            title: `${performerName} asked you to keep managing their role`,
            body: `${performerName} consented on ${productionName} and chose to leave the vault production-held under your management.`,
            href: `/consent/cast/${data.castId}`,
          });
        }
      } catch { /* best-effort */ }
    })();
  }

  return NextResponse.json({ ok: true, choice });
}
