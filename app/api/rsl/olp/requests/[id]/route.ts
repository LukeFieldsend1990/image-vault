import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rslLicenseRequests } from "@/lib/db/schema";
import { collectDelivery, offerForUsage } from "@/lib/rsl/olp";
import { baseUrl } from "@/lib/rsl/profile";

/**
 * Public status poll for an OLP request (by opaque request_id). A client that
 * received `authorization_pending` polls here; once a human approves, the minted
 * license token is delivered ONCE (then removed from the one-time store).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const row = await db.select().from(rslLicenseRequests).where(eq(rslLicenseRequests.id, id)).get();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const base = {
    request_id: row.id,
    status: row.status,
    usage: row.usage,
    offer: offerForUsage(row.usage, `${baseUrl()}/api/rsl/olp`),
  };

  if (row.status === "granted") {
    // Hand back the freshly-minted token once (async/amber grants only).
    const license = await collectDelivery(row.id);
    return NextResponse.json({
      ...base,
      ...(license ? { license, token_type: "rsl-license", expires_at: row.licenseExpiresAt } : {}),
    });
  }
  return NextResponse.json(base);
}
