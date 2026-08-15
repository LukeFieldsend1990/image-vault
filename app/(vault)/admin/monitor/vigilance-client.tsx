"use client";

import { useCallback, useEffect, useState } from "react";

interface PersonaRow {
  id: string;
  personName: string;
  characterName: string | null;
  extraTerms: string[];
  protectedTalentId: string | null;
  protectedTalentName: string | null;
}

interface EventRow {
  id: string;
  kind: string;
  title: string;
  productionTitle: string | null;
  announcedAt: number;
  expiresAt: number;
  status: string;
  notes: string | null;
  phase: "peak" | "elevated" | null;
  daysSinceAnnouncement: number;
  personas: PersonaRow[];
  hitsInWindow: number;
}

const PHASE_COPY: Record<string, string> = {
  peak: "Peak — surge sweeps every 12h",
  elevated: "Elevated — sweeps every 24h",
};

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function VigilanceClient() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [production, setProduction] = useState("");
  const [windowDays, setWindowDays] = useState(60);
  const [castText, setCastText] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/events");
    if (!res.ok) return;
    const data = (await res.json()) as { events: EventRow[] };
    setEvents(data.events);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/monitor/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          productionTitle: production || undefined,
          windowDays,
          castText,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "Could not open the window");
        return;
      }
      setMessage("Window open — it applies from each talent's next sweep.");
      setTitle("");
      setProduction("");
      setCastText("");
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }, [title, production, windowDays, castText, load]);

  const patch = useCallback(
    async (eventId: string, body: Record<string, unknown>) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/events", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, ...body }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setMessage(data.error ?? "Update failed");
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Vigilance windows
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Synthetic content arrives in waves, and the waves are triggered — a cast reveal, a trailer,
          a premiere. While a window is open, sweeps for the named personas add the wave&apos;s own
          vocabulary (character and production, not just the actor&apos;s name), accept a corroborated
          role reference as an identity match, and run on a surge interval. Windows decay and expire;
          they raise the priority of a sweep, never lower its evidence bar.
        </p>
      </div>

      {message && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {message}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-3 py-1.5 rounded"
        style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
      >
        {open ? "Cancel" : "Open a window"}
      </button>

      {open && (
        <div
          className="rounded p-4 space-y-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--color-muted)" }}>
              Event
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="X-Men cast announcement"
                className="mt-1 w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
              />
            </label>
            <label className="text-xs" style={{ color: "var(--color-muted)" }}>
              Production
              <input
                value={production}
                onChange={(e) => setProduction(e.target.value)}
                placeholder="X-Men"
                className="mt-1 w-full text-sm px-2 py-1.5 rounded"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
              />
            </label>
          </div>

          <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
            Cast — paste the announcement as it was published
            <textarea
              value={castText}
              onChange={(e) => setCastText(e.target.value)}
              rows={6}
              placeholder={"Kit Connor as Scott Summers/Cyclops\nSadie Sink as Jean Grey"}
              className="mt-1 w-full text-sm px-2 py-1.5 rounded font-mono"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
            />
            <span className="block mt-1">
              One per line or bullet-separated. &ldquo;Actor as Character&rdquo; is parsed into a
              persona; a slash in the character field is read as two aliases (Scott Summers, Cyclops).
            </span>
          </label>

          <label className="text-xs block" style={{ color: "var(--color-muted)" }}>
            Window length
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              className="ml-2 text-sm px-2 py-1 rounded"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
            >
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>

          <button
            onClick={() => void create()}
            disabled={busy || !title.trim() || !castText.trim()}
            className="text-xs px-3 py-1.5 rounded"
            style={{ background: "var(--color-accent)", color: "#fff", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Opening…" : "Open window"}
          </button>
        </div>
      )}

      {!events ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Loading windows…
        </p>
      ) : !events.length ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          No windows recorded.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded p-4 space-y-3"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {event.title}
                    {event.productionTitle && (
                      <span className="font-normal" style={{ color: "var(--color-muted)" }}>
                        {" "}
                        — {event.productionTitle}
                      </span>
                    )}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                    Announced {formatDate(event.announcedAt)} ({event.daysSinceAnnouncement}d ago) ·
                    {event.status === "closed"
                      ? " closed"
                      : event.phase
                        ? ` ${PHASE_COPY[event.phase]}`
                        : " expired"}{" "}
                    · expires {formatDate(event.expiresAt)} · {event.hitsInWindow} hit
                    {event.hitsInWindow === 1 ? "" : "s"} detected in window
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => void patch(event.id, { extendDays: 30 })}
                    disabled={busy}
                    className="text-xs px-2 py-1 rounded"
                    style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
                  >
                    +30d
                  </button>
                  <button
                    onClick={() =>
                      void patch(event.id, {
                        status: event.status === "closed" ? "active" : "closed",
                      })
                    }
                    disabled={busy}
                    className="text-xs px-2 py-1 rounded"
                    style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)" }}
                  >
                    {event.status === "closed" ? "Reopen" : "Close"}
                  </button>
                </div>
              </div>

              <div className="grid gap-1.5">
                {event.personas.map((p) => (
                  <div key={p.id} className="flex items-baseline justify-between gap-3 text-xs">
                    <span style={{ color: "var(--color-ink)" }}>
                      {p.personName}
                      {p.characterName && (
                        <span style={{ color: "var(--color-muted)" }}> as {p.characterName}</span>
                      )}
                    </span>
                    <span
                      className="font-mono uppercase tracking-widest shrink-0"
                      style={{
                        color: p.protectedTalentId ? "var(--color-accent)" : "var(--color-muted)",
                      }}
                    >
                      {p.protectedTalentId ? "swept" : "not on roster"}
                    </span>
                  </div>
                ))}
              </div>

              {event.personas.some((p) => !p.protectedTalentId) && (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Personas marked <em>not on roster</em> have no vault identity to match against, so
                  they are tracked but not swept. They become swept automatically on their next sweep
                  once a talent profile with that name exists.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
