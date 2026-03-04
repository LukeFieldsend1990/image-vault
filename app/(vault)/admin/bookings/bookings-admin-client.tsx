"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Slot {
  id: string;
  startTime: number;
  status: "available" | "reserved" | "completed" | "cancelled";
  bookingId: string | null;
  bookingStatus: string | null;
  bookingNotes: string | null;
  talentId: string | null;
  talentEmail: string | null;
  talentName: string | null;
}

interface EventData {
  id: string;
  date: number;
  slotDurationMins: number;
  status: "open" | "full" | "cancelled";
  notes: string | null;
  locationId: string | null;
  locationName: string | null;
  city: string | null;
  address: string | null;
  slots: Slot[];
  bookedCount: number;
  totalCount: number;
}

interface Location {
  id: string;
  name: string;
  city: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


function statusBadge(status: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    open: { bg: "rgba(22,101,52,0.1)", color: "#166534", label: "Open" },
    full: { bg: "rgba(217,119,6,0.1)", color: "#d97706", label: "Full" },
    cancelled: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: "Cancelled" },
    available: { bg: "rgba(22,101,52,0.1)", color: "#166534", label: "Available" },
    reserved: { bg: "rgba(217,119,6,0.1)", color: "#d97706", label: "Reserved" },
    confirmed: { bg: "rgba(22,101,52,0.1)", color: "#166534", label: "Confirmed" },
    completed: { bg: "rgba(99,102,241,0.12)", color: "#4f46e5", label: "Completed" },
  };
  const s = map[status] ?? { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: status };
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function BookingsAdminClient() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create event form state
  const [form, setForm] = useState({
    locationId: "",
    date: "",           // YYYY-MM-DD
    slotTimes: [""],    // HH:MM strings
    slotDurationMins: "90",
    notes: "",
  });
  const [createStatus, setCreateStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bookings");
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { events: EventData[]; locations: Location[] };
      setEvents(data.events);
      setLocations(data.locations);
      if (!form.locationId && data.locations.length > 0) {
        setForm((f) => ({ ...f, locationId: data.locations[0].id }));
      }
    } catch {
      setError("Could not load bookings data.");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Slot time helpers
  function addSlotTime() {
    setForm((f) => ({ ...f, slotTimes: [...f.slotTimes, ""] }));
  }
  function removeSlotTime(i: number) {
    setForm((f) => ({ ...f, slotTimes: f.slotTimes.filter((_, idx) => idx !== i) }));
  }
  function updateSlotTime(i: number, val: string) {
    setForm((f) => {
      const arr = [...f.slotTimes];
      arr[i] = val;
      return { ...f, slotTimes: arr };
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateStatus("loading");
    setCreateError(null);

    const dateMs = new Date(form.date + "T00:00:00Z").getTime();
    if (isNaN(dateMs)) {
      setCreateError("Invalid date");
      setCreateStatus("error");
      return;
    }
    const dateUnix = Math.floor(dateMs / 1000);

    const slotTimestamps = form.slotTimes
      .filter((t) => t.trim())
      .map((t) => {
        const [h, m] = t.split(":").map(Number);
        return dateUnix + h * 3600 + m * 60;
      });

    if (slotTimestamps.length === 0) {
      setCreateError("Add at least one slot time");
      setCreateStatus("error");
      return;
    }

    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: form.locationId,
          date: dateUnix,
          slotTimes: slotTimestamps,
          slotDurationMins: parseInt(form.slotDurationMins) || 90,
          notes: form.notes || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create event");
      setCreateStatus("success");
      setForm((f) => ({ ...f, date: "", slotTimes: [""], notes: "" }));
      await fetchAll();
      setTimeout(() => setCreateStatus("idle"), 3000);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed");
      setCreateStatus("error");
    }
  }

  async function handleSlotAction(slotId: string, status: "completed" | "cancelled") {
    try {
      const res = await fetch(`/api/admin/bookings/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Scan Bookings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Create popup scan events and manage talent bookings.
        </p>
      </div>

      {/* Create event form */}
      <div className="rounded-lg border p-6 mb-8" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--color-ink)" }}>Create Popup Event</h2>

        {createStatus === "success" && (
          <div className="mb-4 px-4 py-2 rounded border text-sm" style={{ background: "rgba(22,101,52,0.06)", borderColor: "rgba(22,101,52,0.2)", color: "#166534" }}>
            Event created successfully.
          </div>
        )}
        {createStatus === "error" && createError && (
          <div className="mb-4 px-4 py-2 rounded border text-sm" style={{ background: "rgba(153,27,27,0.06)", borderColor: "rgba(153,27,27,0.2)", color: "#991b1b" }}>
            {createError}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Location */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                Location
              </label>
              <select
                value={form.locationId}
                onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                required
                className="w-full rounded border px-3 py-2 text-sm bg-transparent focus:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}, {l.city}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                Date
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
                className="w-full rounded border px-3 py-2 text-sm bg-transparent focus:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Duration */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                Slot Duration (mins)
              </label>
              <input
                type="number"
                value={form.slotDurationMins}
                onChange={(e) => setForm((f) => ({ ...f, slotDurationMins: e.target.value }))}
                min={15}
                max={480}
                required
                className="w-full rounded border px-3 py-2 text-sm bg-transparent focus:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
                Notes (optional)
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Bring photo ID"
                className="w-full rounded border px-3 py-2 text-sm bg-transparent focus:outline-none"
                style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
              />
            </div>
          </div>

          {/* Slot times */}
          <div>
            <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
              Slot Start Times
            </label>
            <div className="space-y-2">
              {form.slotTimes.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => updateSlotTime(i, e.target.value)}
                    required
                    className="rounded border px-3 py-2 text-sm bg-transparent focus:outline-none"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                  />
                  {form.slotTimes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlotTime(i)}
                      className="text-xs px-2 py-1.5 rounded border hover:opacity-70 transition"
                      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addSlotTime}
                className="text-xs px-3 py-1.5 rounded border hover:opacity-70 transition"
                style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
              >
                + Add time
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={createStatus === "loading"}
            className="px-5 py-2 rounded text-sm font-medium transition hover:opacity-80"
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {createStatus === "loading" ? "Creating…" : "Create Event"}
          </button>
        </form>
      </div>

      {/* Events list */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>All Events</h2>

      {loading && (
        <div className="text-sm py-6 text-center" style={{ color: "var(--color-muted)" }}>Loading…</div>
      )}
      {error && (
        <div className="px-4 py-3 rounded border text-sm" style={{ background: "rgba(153,27,27,0.06)", borderColor: "rgba(153,27,27,0.2)", color: "#991b1b" }}>
          {error}
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="text-sm py-6 text-center" style={{ color: "var(--color-muted)" }}>No events yet.</div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="space-y-3">
          {events.map((ev) => (
            <div key={ev.id} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              {/* Event row */}
              <button
                onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:opacity-80 transition text-left"
              >
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      {ev.locationName ?? "Unknown"}{ev.city ? `, ${ev.city}` : ""}
                    </span>
                    {statusBadge(ev.status)}
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {formatDateLong(ev.date)} &middot; {ev.bookedCount}/{ev.totalCount} slots booked
                    {ev.notes ? ` · ${ev.notes}` : ""}
                  </p>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transition: "transform 0.15s ease",
                    transform: expandedId === ev.id ? "rotate(180deg)" : "rotate(0deg)",
                    color: "var(--color-muted)",
                    flexShrink: 0,
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Expanded slots */}
              {expandedId === ev.id && (
                <div className="border-t" style={{ borderColor: "var(--color-border)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th className="px-5 py-2 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)", width: 100 }}>Time</th>
                        <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Talent</th>
                        <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Status</th>
                        <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.slots.map((slot) => (
                        <tr key={slot.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                          <td className="px-5 py-3 font-mono" style={{ color: "var(--color-ink)" }}>
                            {formatTime(slot.startTime)}
                          </td>
                          <td className="px-4 py-3" style={{ color: "var(--color-ink)" }}>
                            {slot.talentName ?? slot.talentEmail ?? (
                              <span style={{ color: "var(--color-muted)" }}>—</span>
                            )}
                            {slot.talentEmail && slot.talentName && (
                              <span className="block text-[10px]" style={{ color: "var(--color-muted)" }}>{slot.talentEmail}</span>
                            )}
                            {slot.bookingNotes && (
                              <span className="block text-[10px] italic" style={{ color: "var(--color-muted)" }}>{slot.bookingNotes}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {statusBadge(slot.bookingId ? (slot.bookingStatus ?? "confirmed") : slot.status)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {slot.status !== "completed" && slot.status !== "cancelled" && (
                              <div className="flex items-center justify-end gap-2">
                                {slot.bookingId && slot.bookingStatus !== "cancelled" && (
                                  <button
                                    onClick={() => handleSlotAction(slot.id, "completed")}
                                    className="px-2 py-1 rounded border hover:opacity-70 transition"
                                    style={{ borderColor: "rgba(99,102,241,0.3)", color: "#4f46e5" }}
                                  >
                                    Mark done
                                  </button>
                                )}
                                <button
                                  onClick={() => handleSlotAction(slot.id, "cancelled")}
                                  className="px-2 py-1 rounded border hover:opacity-70 transition"
                                  style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {ev.slots.length === 0 && (
                    <p className="px-5 py-3 text-xs" style={{ color: "var(--color-muted)" }}>No slots.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
