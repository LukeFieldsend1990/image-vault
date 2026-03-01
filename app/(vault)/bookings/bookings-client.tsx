"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Slot {
  id: string;
  startTime: number;
  status: "available" | "reserved" | "completed" | "cancelled";
  myBookingId: string | null;
  myBookingStatus: string | null;
}

interface EventData {
  id: string;
  date: number;
  slotDurationMins: number;
  notes: string | null;
  locationId: string;
  locationName: string | null;
  city: string | null;
  address: string | null;
  slots: Slot[];
  availableCount: number;
  totalCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(unix: number, durationMins: number): string {
  const start = new Date(unix * 1000);
  const end = new Date((unix + durationMins * 60) * 1000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatDateLong(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function toMidnightUTC(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / 1000);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Main component ─────────────────────────────────────────────────────────

export default function BookingsClient() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null); // midnight UTC unix
  const [booking, setBooking] = useState<{ slotId: string } | null>(null);
  const [bookingStatus, setBookingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/events");
      if (!res.ok) throw new Error("Failed to load bookings");
      const data = (await res.json()) as { events: EventData[] };
      setEvents(data.events);
    } catch {
      setError("Could not load scan sessions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Build a map: midnight UTC unix → event
  const eventsByDay = new Map<number, EventData>();
  for (const ev of events) {
    eventsByDay.set(ev.date, ev);
  }

  // Calendar grid for current month
  const firstOfMonth = new Date(year, month, 1);
  // JS getDay: 0=Sun; we want Mon=0
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  // My upcoming bookings (confirmed)
  const myBookings = events
    .flatMap((ev) =>
      ev.slots
        .filter((s) => s.myBookingId && s.myBookingStatus === "confirmed")
        .map((s) => ({ ...s, event: ev }))
    )
    .sort((a, b) => a.startTime - b.startTime);

  const selectedEvent = selectedDay != null ? eventsByDay.get(selectedDay) ?? null : null;

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  async function handleBook(slotId: string) {
    setBooking({ slotId });
    setBookingStatus("loading");
    setBookingError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Booking failed");
      setBookingStatus("success");
      await fetchEvents();
    } catch (e) {
      setBookingStatus("error");
      setBookingError(e instanceof Error ? e.message : "Booking failed");
    }
  }

  async function handleCancel(bookingId: string) {
    if (!confirm("Cancel this booking? This cannot be undone within 48 hours of the session.")) return;
    setCancellingId(bookingId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Cancel failed");
      await fetchEvents();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not cancel booking");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Scan Sessions
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Book a Scan
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Reserve a 90-minute biometric scan slot at one of our partner venues. Your data will be uploaded to your vault within 24 hours.
        </p>
      </div>

      {loading && (
        <div className="text-sm py-8 text-center" style={{ color: "var(--color-muted)" }}>
          Loading sessions…
        </div>
      )}

      {error && (
        <div className="text-sm px-4 py-3 rounded border mb-6" style={{ background: "rgba(153,27,27,0.06)", borderColor: "rgba(153,27,27,0.2)", color: "#991b1b" }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="flex gap-6 items-start flex-wrap lg:flex-nowrap">
          {/* Calendar */}
          <div className="flex-shrink-0" style={{ minWidth: 320 }}>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              {/* Month nav */}
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
                <button
                  onClick={prevMonth}
                  className="p-1 rounded hover:opacity-70 transition"
                  aria-label="Previous month"
                  style={{ color: "var(--color-muted)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {MONTH_NAMES[month]} {year}
                </span>
                <button
                  onClick={nextMonth}
                  className="p-1 rounded hover:opacity-70 transition"
                  aria-label="Next month"
                  style={{ color: "var(--color-muted)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 border-b" style={{ borderColor: "var(--color-border)" }}>
                {DAY_NAMES.map((d) => (
                  <div key={d} className="py-2 text-center text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-muted)" }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7">
                {Array.from({ length: totalCells }).map((_, i) => {
                  const dayNum = i - startDow + 1;
                  if (dayNum < 1 || dayNum > daysInMonth) {
                    return <div key={i} className="aspect-square" />;
                  }
                  const midnight = toMidnightUTC(year, month, dayNum);
                  const ev = eventsByDay.get(midnight);
                  const isToday =
                    dayNum === today.getDate() &&
                    month === today.getMonth() &&
                    year === today.getFullYear();
                  const isSelected = selectedDay === midnight;
                  const isPast = midnight < toMidnightUTC(today.getFullYear(), today.getMonth(), today.getDate());

                  return (
                    <button
                      key={i}
                      disabled={!ev || isPast}
                      onClick={() => setSelectedDay(isSelected ? null : midnight)}
                      className="aspect-square flex flex-col items-center justify-center gap-0.5 rounded transition relative"
                      style={{
                        background: isSelected ? "var(--color-accent)" : "transparent",
                        color: isSelected ? "#fff" : isPast ? "var(--color-border)" : "var(--color-ink)",
                        cursor: ev && !isPast ? "pointer" : "default",
                        opacity: isPast ? 0.4 : 1,
                      }}
                    >
                      <span className={`text-xs font-medium ${isToday && !isSelected ? "underline underline-offset-2" : ""}`}>
                        {dayNum}
                      </span>
                      {ev && !isPast && (
                        <span
                          className="w-1 h-1 rounded-full"
                          style={{ background: isSelected ? "rgba(255,255,255,0.7)" : "var(--color-accent)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex items-center gap-3 text-xs px-1" style={{ color: "var(--color-muted)" }}>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-accent)" }} />
                Session available
              </span>
            </div>
          </div>

          {/* Right panel: day detail or empty state */}
          <div className="flex-1 min-w-0">
            {selectedEvent ? (
              <DayPanel
                event={selectedEvent}
                onBook={handleBook}
                bookingState={{ slotId: booking?.slotId ?? null, status: bookingStatus, error: bookingError }}
                onDismiss={() => { setBookingStatus("idle"); setBooking(null); setBookingError(null); }}
              />
            ) : (
              <div
                className="rounded-lg border p-8 text-center"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}
              >
                <svg className="mx-auto mb-3 opacity-30" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p className="text-sm">Select a date with a session to view available slots.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* My upcoming bookings */}
      {myBookings.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>
            My upcoming sessions
          </h2>
          <div className="space-y-2">
            {myBookings.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {s.event.locationName ?? "TBC"}{s.event.city ? `, ${s.event.city}` : ""}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                    {formatDateLong(s.startTime)} &middot; {formatTime(s.startTime, s.event.slotDurationMins)}
                  </p>
                </div>
                <button
                  onClick={() => handleCancel(s.myBookingId!)}
                  disabled={cancellingId === s.myBookingId}
                  className="text-xs px-3 py-1.5 rounded border transition hover:opacity-80"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                >
                  {cancellingId === s.myBookingId ? "Cancelling…" : "Cancel"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Day panel ─────────────────────────────────────────────────────────────

function DayPanel({
  event,
  onBook,
  bookingState,
  onDismiss,
}: {
  event: EventData;
  onBook: (slotId: string) => void;
  bookingState: { slotId: string | null; status: string; error: string | null };
  onDismiss: () => void;
}) {
  const hasMyBooking = event.slots.some((s) => s.myBookingId && s.myBookingStatus === "confirmed");

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      {/* Location header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: "var(--color-accent)" }}>
          {event.city}
        </p>
        <h3 className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
          {event.locationName}
        </h3>
        {event.address && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{event.address}</p>
        )}
        <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>
          {formatDateLong(event.date)} &middot; {event.slotDurationMins} min session
        </p>
        {event.notes && (
          <p className="text-xs mt-1 italic" style={{ color: "var(--color-muted)" }}>{event.notes}</p>
        )}
      </div>

      {/* Booking feedback */}
      {bookingState.status === "success" && (
        <div className="mx-4 mt-4 px-4 py-3 rounded border text-sm" style={{ background: "rgba(22,101,52,0.06)", borderColor: "rgba(22,101,52,0.2)", color: "#166534" }}>
          Booking confirmed! A confirmation email has been sent.{" "}
          <button onClick={onDismiss} className="underline text-xs ml-1">Dismiss</button>
        </div>
      )}
      {bookingState.status === "error" && bookingState.error && (
        <div className="mx-4 mt-4 px-4 py-3 rounded border text-sm" style={{ background: "rgba(153,27,27,0.06)", borderColor: "rgba(153,27,27,0.2)", color: "#991b1b" }}>
          {bookingState.error}{" "}
          <button onClick={onDismiss} className="underline text-xs ml-1">Dismiss</button>
        </div>
      )}

      {/* Already booked */}
      {hasMyBooking && (
        <div className="mx-4 mt-4 px-4 py-2 rounded border text-xs" style={{ background: "rgba(217,119,6,0.06)", borderColor: "rgba(217,119,6,0.2)", color: "#d97706" }}>
          You already have a confirmed booking for this session.
        </div>
      )}

      {/* Slots */}
      <div className="p-4 space-y-2">
        {event.slots.length === 0 && (
          <p className="text-sm text-center py-4" style={{ color: "var(--color-muted)" }}>No slots for this event.</p>
        )}
        {event.slots.map((slot) => {
          const isMySlot = !!slot.myBookingId && slot.myBookingStatus === "confirmed";
          const isAvailable = slot.status === "available";
          const timeLabel = formatTime(slot.startTime, event.slotDurationMins);
          const isBookingThis = bookingState.slotId === slot.id;

          return (
            <div
              key={slot.id}
              className="flex items-center justify-between rounded border px-4 py-3"
              style={{
                borderColor: isMySlot ? "rgba(22,101,52,0.3)" : "var(--color-border)",
                background: isMySlot ? "rgba(22,101,52,0.04)" : "transparent",
              }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{timeLabel}</p>
                {isMySlot && (
                  <p className="text-[10px] uppercase tracking-wider font-semibold mt-0.5" style={{ color: "#166534" }}>
                    Your booking
                  </p>
                )}
              </div>
              <div>
                {isMySlot ? (
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>
                    Confirmed
                  </span>
                ) : isAvailable && !hasMyBooking ? (
                  <button
                    onClick={() => onBook(slot.id)}
                    disabled={isBookingThis && bookingState.status === "loading"}
                    className="text-xs font-medium px-3 py-1.5 rounded transition hover:opacity-80"
                    style={{ background: "var(--color-accent)", color: "#fff" }}
                  >
                    {isBookingThis && bookingState.status === "loading" ? "Booking…" : "Book slot"}
                  </button>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--color-muted)" }}>
                    {slot.status === "available" ? "–" : slot.status}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Arrival note */}
      <div className="px-5 pb-4">
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          Please arrive 10 minutes before your slot. Wear close-fitting, neutral-coloured clothing. Avoid jewellery.
        </p>
      </div>
    </div>
  );
}
