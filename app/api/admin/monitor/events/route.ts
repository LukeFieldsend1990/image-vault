import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { likenessHits } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import {
  createVigilanceEvent,
  listVigilanceEvents,
  updateVigilanceEvent,
  type PersonaSpec,
} from "@/lib/monitor/events";
import {
  DEFAULT_WINDOW_DAYS,
  VIGILANCE_EVENT_KINDS,
  parseCastAnnouncement,
  type VigilanceEventKind,
} from "@/lib/monitor/vigilance";

async function guard(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return { error: session };
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

// GET /api/admin/monitor/events — every vigilance window, newest first, with
// its personas, whether each one resolves to a protected talent, and how many
// hits have been detected while the window was open.
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const db = getDb();
  const events = await listVigilanceEvents(db);

  const counts = new Map<string, number>();
  if (events.length) {
    const rows = await db
      .select({ eventId: likenessHits.vigilanceEventId, n: sql<number>`count(*)` })
      .from(likenessHits)
      .where(sql`${likenessHits.vigilanceEventId} is not null`)
      .groupBy(likenessHits.vigilanceEventId)
      .all();
    for (const r of rows) if (r.eventId) counts.set(r.eventId, r.n);
  }

  return NextResponse.json({
    events: events.map((e) => ({ ...e, hitsInWindow: counts.get(e.id) ?? 0 })),
    kinds: VIGILANCE_EVENT_KINDS,
    defaultWindowDays: DEFAULT_WINDOW_DAYS,
  });
}

/**
 * POST /api/admin/monitor/events — open a window.
 *
 * Personas can be supplied structured, or as the raw text of the announcement
 * (`castText`), which is what an operator actually has to hand: a block copied
 * out of a trade story or a studio post. Parsing it here rather than making
 * someone retype seven rows is the difference between the window being open
 * within the hour of the announcement and being opened next week.
 */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;
  const session = g.session!;

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    title?: string;
    productionTitle?: string;
    sourceUrl?: string;
    announcedAt?: number;
    windowDays?: number;
    notes?: string;
    castText?: string;
    personas?: Array<{ personName?: string; characterName?: string; extraTerms?: string[] }>;
  };

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const kind = (body.kind ?? "cast_announcement") as VigilanceEventKind;
  if (!VIGILANCE_EVENT_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  }

  const personas: PersonaSpec[] = [];
  for (const p of body.personas ?? []) {
    if (!p.personName?.trim()) continue;
    personas.push({
      personName: p.personName.trim(),
      characterName: p.characterName?.trim() || null,
      extraTerms: Array.isArray(p.extraTerms) ? p.extraTerms.map(String) : [],
    });
  }
  if (typeof body.castText === "string" && body.castText.trim()) {
    for (const parsed of parseCastAnnouncement(body.castText)) {
      personas.push({ personName: parsed.personName, characterName: parsed.characterName });
    }
  }
  if (!personas.length) {
    return NextResponse.json(
      { error: "At least one persona is required — a window with nobody in it steers nothing." },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = await createVigilanceEvent(db, {
    kind,
    title,
    productionTitle: body.productionTitle?.trim() || null,
    sourceUrl: body.sourceUrl?.trim() || null,
    announcedAt:
      typeof body.announcedAt === "number" && Number.isFinite(body.announcedAt)
        ? Math.floor(body.announcedAt)
        : undefined,
    windowDays: typeof body.windowDays === "number" ? Math.floor(body.windowDays) : undefined,
    notes: body.notes?.trim() || null,
    createdBy: session.sub,
    personas,
  });

  const events = await listVigilanceEvents(db);
  return NextResponse.json({ ok: true, id, event: events.find((e) => e.id === id) ?? null });
}

// PATCH /api/admin/monitor/events — close, reopen or extend a window.
export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    eventId?: string;
    status?: string;
    extendDays?: number;
  };
  if (typeof body.eventId !== "string" || !body.eventId) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }
  if (body.status && body.status !== "active" && body.status !== "closed") {
    return NextResponse.json({ error: "status must be active or closed" }, { status: 400 });
  }

  const db = getDb();
  const ok = await updateVigilanceEvent(db, body.eventId, {
    status: body.status as "active" | "closed" | undefined,
    extendDays: typeof body.extendDays === "number" ? Math.floor(body.extendDays) : undefined,
  });
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
