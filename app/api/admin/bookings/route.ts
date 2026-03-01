export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scanEvents, scanSlots, scanLocations, scanBookings, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, desc, inArray, ne, and } from "drizzle-orm";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

async function requireAdminSession(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!ADMIN_EMAILS.includes(session.email ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// GET /api/admin/bookings — all events with slots + booking details
export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  const db = getDb();

  const events = await db
    .select({
      id: scanEvents.id,
      date: scanEvents.date,
      slotDurationMins: scanEvents.slotDurationMins,
      status: scanEvents.status,
      notes: scanEvents.notes,
      createdAt: scanEvents.createdAt,
      locationId: scanLocations.id,
      locationName: scanLocations.name,
      city: scanLocations.city,
      address: scanLocations.address,
    })
    .from(scanEvents)
    .leftJoin(scanLocations, eq(scanLocations.id, scanEvents.locationId))
    .orderBy(desc(scanEvents.date))
    .all();

  // Always fetch locations so the create form can populate even when no events exist
  const locations = await db
    .select({ id: scanLocations.id, name: scanLocations.name, city: scanLocations.city })
    .from(scanLocations)
    .where(eq(scanLocations.active, true))
    .all();

  if (events.length === 0) return NextResponse.json({ events: [], locations });

  const eventIds = events.map((e) => e.id);

  const slots = await db
    .select({
      id: scanSlots.id,
      eventId: scanSlots.eventId,
      startTime: scanSlots.startTime,
      status: scanSlots.status,
      bookingId: scanBookings.id,
      bookingStatus: scanBookings.status,
      bookingNotes: scanBookings.notes,
      talentId: scanBookings.talentId,
      talentEmail: users.email,
      talentName: talentProfiles.fullName,
    })
    .from(scanSlots)
    .leftJoin(scanBookings, and(eq(scanBookings.slotId, scanSlots.id), ne(scanBookings.status, "cancelled")))
    .leftJoin(users, eq(users.id, scanBookings.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, scanBookings.talentId))
    .where(inArray(scanSlots.eventId, eventIds))
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
    return {
      ...ev,
      slots: evSlots,
      bookedCount: evSlots.filter((s) => s.bookingId !== null).length,
      totalCount: evSlots.length,
    };
  });

  return NextResponse.json({ events: result, locations });
}

// POST /api/admin/bookings — create a popup event with slots
export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (isErrorResponse(session)) return session;
  if (session instanceof NextResponse) return session;

  let body: {
    locationId?: string;
    date?: number;         // unix timestamp (midnight UTC)
    slotTimes?: number[];  // array of unix timestamps for each slot start
    slotDurationMins?: number;
    notes?: string;
  } = {};
  try { body = JSON.parse(await req.text()); } catch { /* ok */ }

  if (!body.locationId || !body.date || !body.slotTimes?.length) {
    return NextResponse.json({ error: "locationId, date, and slotTimes are required" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const eventId = crypto.randomUUID();

  await db.insert(scanEvents).values({
    id: eventId,
    locationId: body.locationId,
    date: body.date,
    slotDurationMins: body.slotDurationMins ?? 90,
    notes: body.notes ?? null,
    status: "open",
    createdAt: now,
  });

  await db.insert(scanSlots).values(
    body.slotTimes.map((startTime) => ({
      id: crypto.randomUUID(),
      eventId,
      startTime,
      status: "available" as const,
      createdAt: now,
    }))
  );

  return NextResponse.json({ eventId }, { status: 201 });
}
