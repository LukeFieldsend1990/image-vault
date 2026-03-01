export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanBookings, scanSlots, scanEvents, scanLocations, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { scanBookingCancelledEmail } from "@/lib/email/templates";

// DELETE /api/bookings/[id] — talent cancels a booking (must be >48h before slot)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [booking] = await db
    .select({
      id: scanBookings.id,
      talentId: scanBookings.talentId,
      status: scanBookings.status,
      slotId: scanBookings.slotId,
      startTime: scanSlots.startTime,
      locationName: scanLocations.name,
      city: scanLocations.city,
      durationMins: scanEvents.slotDurationMins,
    })
    .from(scanBookings)
    .leftJoin(scanSlots, eq(scanSlots.id, scanBookings.slotId))
    .leftJoin(scanEvents, eq(scanEvents.id, scanSlots.eventId))
    .leftJoin(scanLocations, eq(scanLocations.id, scanEvents.locationId))
    .where(and(eq(scanBookings.id, id), eq(scanBookings.talentId, session.sub)))
    .limit(1)
    .all();

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "This booking cannot be cancelled" }, { status: 409 });
  }

  const cutoff = 48 * 60 * 60; // 48 hours in seconds
  if ((booking.startTime ?? 0) - now < cutoff) {
    return NextResponse.json(
      { error: "Bookings cannot be cancelled within 48 hours of the session" },
      { status: 409 }
    );
  }

  await db.update(scanBookings).set({ status: "cancelled", cancelledAt: now }).where(eq(scanBookings.id, id));
  await db.update(scanSlots).set({ status: "available" }).where(eq(scanSlots.id, booking.slotId));

  // Send cancellation email (fire-and-forget)
  void (async () => {
    const talentUser = await db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get();
    if (!talentUser?.email) return;
    const { subject, html } = scanBookingCancelledEmail({
      talentEmail: talentUser.email,
      locationName: booking.locationName ?? "TBC",
      city: booking.city ?? "",
      startTime: booking.startTime ?? 0,
      durationMins: booking.durationMins ?? 90,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ cancelled: true });
}
