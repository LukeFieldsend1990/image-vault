export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanSlots, scanBookings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and } from "drizzle-orm";

// PATCH /api/admin/bookings/slots/[id] — mark slot completed or cancelled
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { status?: "completed" | "cancelled" } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  if (!body.status || !["completed", "cancelled"].includes(body.status)) {
    return NextResponse.json({ error: "status must be 'completed' or 'cancelled'" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  await db.update(scanSlots).set({ status: body.status }).where(eq(scanSlots.id, id));

  // Also update the booking status if one exists
  if (body.status === "completed") {
    await db
      .update(scanBookings)
      .set({ status: "completed" })
      .where(and(eq(scanBookings.slotId, id), eq(scanBookings.status, "confirmed")));
  }
  if (body.status === "cancelled") {
    await db
      .update(scanBookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(scanBookings.slotId, id), eq(scanBookings.status, "confirmed")));
  }

  return NextResponse.json({ updated: true });
}
