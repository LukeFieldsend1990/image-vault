export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanSlots, scanBookings, scanEvents, scanLocations, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, ne } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { scanBookingConfirmedEmail } from "@/lib/email/templates";

// POST /api/bookings — talent books a slot
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can book scan sessions" }, { status: 403 });
  }

  let body: { slotId?: string; notes?: string } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  if (!body.slotId) {
    return NextResponse.json({ error: "slotId is required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Fetch slot + event in one query
  const [slot] = await db
    .select({
      id: scanSlots.id,
      status: scanSlots.status,
      startTime: scanSlots.startTime,
      eventId: scanSlots.eventId,
      slotDurationMins: scanEvents.slotDurationMins,
      locationName: scanLocations.name,
      city: scanLocations.city,
      address: scanLocations.address,
    })
    .from(scanSlots)
    .leftJoin(scanEvents, eq(scanEvents.id, scanSlots.eventId))
    .leftJoin(scanLocations, eq(scanLocations.id, scanEvents.locationId))
    .where(eq(scanSlots.id, body.slotId))
    .limit(1)
    .all();

  if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });
  if (slot.status !== "available") {
    return NextResponse.json({ error: "This slot is no longer available" }, { status: 409 });
  }

  // Check talent doesn't already have a confirmed booking for this event
  const [existing] = await db
    .select({ id: scanBookings.id })
    .from(scanBookings)
    .leftJoin(scanSlots, eq(scanSlots.id, scanBookings.slotId))
    .where(and(
      eq(scanBookings.talentId, session.sub),
      eq(scanSlots.eventId, slot.eventId),
      ne(scanBookings.status, "cancelled"),
    ))
    .limit(1)
    .all();

  if (existing) {
    return NextResponse.json({ error: "You already have a booking for this event" }, { status: 409 });
  }

  const bookingId = crypto.randomUUID();

  await db.update(scanSlots).set({ status: "reserved" }).where(eq(scanSlots.id, body.slotId));
  await db.insert(scanBookings).values({
    id: bookingId,
    talentId: session.sub,
    slotId: body.slotId,
    status: "confirmed",
    notes: body.notes ?? null,
    createdAt: now,
  });

  // Send confirmation email (fire-and-forget)
  void (async () => {
    const [talentUser, profile] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get(),
      db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, session.sub)).get(),
    ]);
    if (!talentUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";
    const { subject, html } = scanBookingConfirmedEmail({
      talentEmail: talentUser.email,
      talentName: profile?.fullName ?? talentUser.email,
      locationName: slot.locationName ?? "TBC",
      city: slot.city ?? "",
      address: slot.address ?? "",
      startTime: slot.startTime,
      durationMins: slot.slotDurationMins ?? 90,
      bookingUrl: `${baseUrl}/bookings`,
    });
    await sendEmail({ to: talentUser.email, subject, html });
  })();

  return NextResponse.json({ bookingId }, { status: 201 });
}
