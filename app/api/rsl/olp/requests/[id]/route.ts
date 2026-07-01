import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rslLicenseRequests, licences } from "@/lib/db/schema";
import { collectDelivery } from "@/lib/rsl/olp";

/**
 * Public status poll for an OLP request (by opaque request_id). A client that
 * received `authorization_pending` / `offer_available` polls here; once granted,
 * the credential payload (consent token + metered royalty key) is delivered ONCE.
 *
 * Security model: the request_id (a UUIDv4) is the bearer capability for the
 * one-time credential pickup. It's returned only to the client that created the
 * request and is unguessable; the payload lives in KV ~1h and is deleted on
 * first read. Treat the request_id like a secret.
 */

const STATUS_MAP: Record<string, string> = {
  pending_review: "authorization_pending",
  offered: "offer_available",
  accepted: "accepted",
  granted: "granted",
  denied: "denied",
  expired: "expired",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = await db.select().from(rslLicenseRequests).where(eq(rslLicenseRequests.id, id)).get();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let offer: Record<string, unknown> = { usage: row.usage, priced: false };
  if (row.licenceId) {
    const lic = await db
      .select({
        put: licences.proposedUnitType,
        pur: licences.proposedUnitRatePence,
        pf: licences.proposedFee,
      })
      .from(licences)
      .where(eq(licences.id, row.licenceId))
      .get();
    offer = {
      usage: row.usage,
      unit_type: lic?.put ?? null,
      unit_rate_cents: lic?.pur ?? null,
      upfront_fee_cents: lic?.pf ?? null,
      currency: "USD",
      priced: !!lic?.pur,
    };
  }

  const base = { request_id: row.id, status: STATUS_MAP[row.status] ?? row.status, usage: row.usage, offer };

  if (row.status === "granted") {
    const raw = await collectDelivery(row.id);
    if (raw) {
      try {
        return NextResponse.json({ ...base, ...(JSON.parse(raw) as Record<string, unknown>) });
      } catch {
        /* fall through */
      }
    }
  }
  return NextResponse.json(base);
}
