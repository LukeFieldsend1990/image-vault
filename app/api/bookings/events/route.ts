export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanEvents, scanSlots, scanLocations, scanBookings } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, gte, and, inArray, ne } from "drizzle-orm";

// GET /api/bookings/events — upcoming popup events with slot availability
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const todayMidnight = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  const events = await db
    .select({
      id: scanEvents.id,
      date: scanEvents.date,
      slotDurationMins: scanEvents.slotDurationMins,
      status: scanEvents.status,
      notes: scanEvents.notes,
      locationId: scanLocations.id,
      locationName: scanLocations.name,
      city: scanLocations.city,
      address: scanLocations.address,
    })
    .from(scanEvents)
    .leftJoin(scanLocations, eq(scanLocations.id, scanEvents.locationId))
    .where(and(
      gte(scanEvents.date, todayMidnight),
      ne(scanEvents.status, "cancelled"),
    ))
    .orderBy(scanEvents.date)
    .all();

  if (events.length === 0) return NextResponse.json({ events: [] });

  const eventIds = events.map((e) => e.id);

  const slots = await db
    .select({
      id: scanSlots.id,
      eventId: scanSlots.eventId,
      startTime: scanSlots.startTime,
      status: scanSlots.status,
      myBookingId: scanBookings.id,
      myBookingStatus: scanBookings.status,
    })
    .from(scanSlots)
    .leftJoin(
      scanBookings,
      and(
        eq(scanBookings.slotId, scanSlots.id),
        eq(scanBookings.talentId, session.sub),
        ne(scanBookings.status, "cancelled"),
      )
    )
    .where(
      and(
        inArray(scanSlots.eventId, eventIds),
        ne(scanSlots.status, "cancelled"),
      )
    )
    .orderBy(scanSlots.startTime)
    .all();

  const slotsByEvent = new Map<string, typeof slots>();
  for (const slot of slots) {
    const arr = slotsByEvent.get(slot.eventId) ?? [];
    arr.push(slot);
    slotsByEvent.set(slot.eventId, arr);
  }

  const result = events.map((ev) => {
    const evSlots = slotsByEvent.get(ev.id) ?? [];
    const availableCount = evSlots.filter((s) => s.status === "available").length;
    return {
      ...ev,
      slots: evSlots,
      availableCount,
      totalCount: evSlots.length,
    };
  });

  return NextResponse.json({ events: result });
}
