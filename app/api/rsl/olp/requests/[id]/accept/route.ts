import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rslLicenseRequests } from "@/lib/db/schema";
import { notifyTalentAndReps, notifyAdmins } from "@/lib/notifications/create";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";

/**
 * Machine-side accept: an AI client agrees to the current offer on an OLP
 * request. Capability = the opaque request_id. Only an `offered` request (one
 * that a rate card / talent has priced) can be accepted; acceptance moves it to
 * `accepted` and pings the rights-holder to approve and issue the credential.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await checkRateLimit(getClientIp(req), { action: "rsl_olp_accept", maxAttempts: 30, windowSeconds: 600 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  const db = getDb();
  const row = await db.select().from(rslLicenseRequests).where(eq(rslLicenseRequests.id, id)).get();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (row.status === "accepted") {
    return NextResponse.json({ status: "accepted", request_id: row.id });
  }
  if (row.status !== "offered") {
    return NextResponse.json(
      { error: "no_offer", error_description: "There is no priced offer to accept yet." },
      { status: 409 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(rslLicenseRequests)
    .set({ status: "accepted", acceptedAt: now, updatedAt: now })
    .where(eq(rslLicenseRequests.id, id));

  const who = row.clientName || "A machine client";
  void notifyTalentAndReps(db, row.talentId, {
    type: "rsl_license_accepted",
    title: "AI licence — terms accepted",
    body: `${who} accepted your terms for ${row.usage}. Approve to issue their licence.`,
    href: "/vault/requests",
  });
  void notifyAdmins(db, {
    type: "rsl_license_accepted_admin",
    title: "AI licence accepted — ready to approve",
    body: `${who} accepted terms for ${row.usage}.`,
    href: "/admin/rsl",
  });

  return NextResponse.json({ status: "accepted", request_id: row.id });
}
