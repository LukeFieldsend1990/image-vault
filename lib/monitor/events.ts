/**
 * Vigilance events — persistence and resolution.
 *
 * The vocabulary logic is in lib/monitor/vigilance.ts and is pure; this module
 * is the D1 half: create an event from a pasted announcement, list events for
 * the admin console, resolve which personas map to which talent, and build the
 * `VigilanceAnchor` a sweep runs against.
 *
 * Persona → talent resolution is by name slug rather than by a manual link
 * step. An announcement names people, not accounts, and the useful case is the
 * one where the announcement lands *before* the actor is a client: when they
 * sign up, their first sweep already carries the window. Explicit `talentId` on
 * a persona still wins — it is how an operator fixes a name that does not slug
 * cleanly.
 */

import { getDb } from "@/lib/db";
import { monitorEvents, monitorEventPersonas, talentProfiles, users } from "@/lib/db/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { nameSlug } from "./ingest/queries";
import type { VigilanceAnchor } from "./types";
import {
  DEFAULT_WINDOW_DAYS,
  characterAliases,
  compoundAliases,
  daysSince,
  productionAliases,
  vigilanceHashtags,
  vigilancePhase,
  type VigilanceEventKind,
} from "./vigilance";

type Db = ReturnType<typeof getDb>;

const DAY = 86_400;

export interface PersonaSpec {
  personName: string;
  characterName?: string | null;
  extraTerms?: string[];
  talentId?: string | null;
}

export interface CreateEventSpec {
  kind?: VigilanceEventKind;
  title: string;
  productionTitle?: string | null;
  sourceUrl?: string | null;
  announcedAt?: number;
  windowDays?: number;
  notes?: string | null;
  createdBy?: string | null;
  personas: PersonaSpec[];
}

export interface EventPersonaRow {
  id: string;
  personName: string;
  personSlug: string;
  characterName: string | null;
  extraTerms: string[];
  talentId: string | null;
  active: boolean;
  /** Resolved at read time — a persona is only sweepable once it has a talent. */
  protectedTalentId: string | null;
  protectedTalentName: string | null;
}

export interface EventRow {
  id: string;
  kind: string;
  title: string;
  productionTitle: string | null;
  sourceUrl: string | null;
  announcedAt: number;
  expiresAt: number;
  status: string;
  notes: string | null;
  createdAt: number;
  /** null once expired or closed. */
  phase: "peak" | "elevated" | null;
  daysSinceAnnouncement: number;
  personas: EventPersonaRow[];
}

function parseExtraTerms(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** Create an event and its personas. Returns the event id. */
export async function createVigilanceEvent(db: Db, spec: CreateEventSpec): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const announcedAt = spec.announcedAt ?? now;
  const windowDays = Math.min(Math.max(spec.windowDays ?? DEFAULT_WINDOW_DAYS, 1), 365);
  const id = crypto.randomUUID();

  await db.insert(monitorEvents).values({
    id,
    kind: spec.kind ?? "cast_announcement",
    title: spec.title.slice(0, 200),
    productionTitle: spec.productionTitle?.slice(0, 200) ?? null,
    sourceUrl: spec.sourceUrl?.slice(0, 500) ?? null,
    announcedAt,
    expiresAt: announcedAt + windowDays * DAY,
    status: "active",
    notes: spec.notes?.slice(0, 2000) ?? null,
    createdBy: spec.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const seen = new Set<string>();
  for (const persona of spec.personas) {
    const slug = nameSlug(persona.personName);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    await db.insert(monitorEventPersonas).values({
      id: crypto.randomUUID(),
      eventId: id,
      personName: persona.personName.slice(0, 120),
      personSlug: slug,
      characterName: persona.characterName?.slice(0, 160) ?? null,
      extraTermsJson: JSON.stringify((persona.extraTerms ?? []).slice(0, 12)),
      talentId: persona.talentId ?? null,
      active: true,
    });
  }

  return id;
}

/**
 * Map persona slugs to talent ids.
 *
 * One query over talent_profiles rather than a per-persona lookup: the roster
 * is small and the slug is computed in JS, so a full read is cheaper than a
 * name-normalising SQL predicate that D1 cannot index anyway.
 */
async function resolveSlugsToTalent(
  db: Db,
  slugs: Set<string>
): Promise<Map<string, { talentId: string; fullName: string }>> {
  const out = new Map<string, { talentId: string; fullName: string }>();
  if (!slugs.size) return out;

  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .innerJoin(users, eq(users.id, talentProfiles.userId))
    .all();

  for (const p of profiles) {
    const slug = nameSlug(p.fullName ?? "");
    if (!slug || !slugs.has(slug) || out.has(slug)) continue;
    out.set(slug, { talentId: p.userId, fullName: p.fullName ?? "" });
  }
  return out;
}

/** List events newest first, with personas and their resolved protection state. */
export async function listVigilanceEvents(db: Db, limit = 25): Promise<EventRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const events = await db
    .select()
    .from(monitorEvents)
    .orderBy(desc(monitorEvents.announcedAt))
    .limit(limit)
    .all();
  if (!events.length) return [];

  const personas = await db
    .select()
    .from(monitorEventPersonas)
    .where(inArray(monitorEventPersonas.eventId, events.map((e) => e.id)))
    .all();

  const resolved = await resolveSlugsToTalent(db, new Set(personas.map((p) => p.personSlug)));

  const byEvent = new Map<string, EventPersonaRow[]>();
  for (const p of personas) {
    const match = p.talentId ? null : resolved.get(p.personSlug);
    const list = byEvent.get(p.eventId) ?? [];
    list.push({
      id: p.id,
      personName: p.personName,
      personSlug: p.personSlug,
      characterName: p.characterName,
      extraTerms: parseExtraTerms(p.extraTermsJson),
      talentId: p.talentId,
      active: p.active,
      protectedTalentId: p.talentId ?? match?.talentId ?? null,
      protectedTalentName: match?.fullName ?? null,
    });
    byEvent.set(p.eventId, list);
  }

  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    productionTitle: e.productionTitle,
    sourceUrl: e.sourceUrl,
    announcedAt: e.announcedAt,
    expiresAt: e.expiresAt,
    status: e.status,
    notes: e.notes,
    createdAt: e.createdAt,
    phase: e.status === "active" ? vigilancePhase(e.announcedAt, e.expiresAt, now) : null,
    daysSinceAnnouncement: daysSince(e.announcedAt, now),
    personas: byEvent.get(e.id) ?? [],
  }));
}

/** Close a window early, or reopen/extend one. */
export async function updateVigilanceEvent(
  db: Db,
  eventId: string,
  patch: { status?: "active" | "closed"; extendDays?: number }
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const event = await db.select().from(monitorEvents).where(eq(monitorEvents.id, eventId)).get();
  if (!event) return false;

  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.status) set.status = patch.status;
  if (patch.extendDays) {
    const days = Math.min(Math.max(patch.extendDays, 1), 365);
    // Extend from now when the window has already lapsed, so "extend by 14
    // days" means fourteen more days of cover rather than fourteen days from
    // an expiry that is already in the past.
    set.expiresAt = Math.max(event.expiresAt, now) + days * DAY;
  }
  await db.update(monitorEvents).set(set).where(eq(monitorEvents.id, eventId));
  return true;
}

/**
 * Build the vigilance anchor for one talent's sweep, or null when no window is
 * open for them.
 *
 * When more than one window covers the same talent — a cast announcement and
 * then a trailer for the same production — the most recent one wins. Merging
 * them would blow past the query budget in exchange for vocabulary that is
 * mostly duplicated between the two.
 */
export async function loadVigilanceForTalent(
  db: Db,
  talentId: string,
  fullName: string,
  now = Math.floor(Date.now() / 1000)
): Promise<VigilanceAnchor | null> {
  const slug = nameSlug(fullName);

  const rows = await db
    .select({
      persona: monitorEventPersonas,
      event: monitorEvents,
    })
    .from(monitorEventPersonas)
    .innerJoin(monitorEvents, eq(monitorEvents.id, monitorEventPersonas.eventId))
    .where(
      and(
        eq(monitorEventPersonas.active, true),
        eq(monitorEvents.status, "active"),
        gt(monitorEvents.expiresAt, now)
      )
    )
    .all();

  const mine = rows.filter(
    (r) => r.persona.talentId === talentId || (!!slug && r.persona.personSlug === slug)
  );
  if (!mine.length) return null;

  mine.sort((a, b) => b.event.announcedAt - a.event.announcedAt);
  const { persona, event } = mine[0];

  const phase = vigilancePhase(event.announcedAt, event.expiresAt, now);
  if (!phase) return null;

  const characters = characterAliases(persona.characterName);
  const productions = productionAliases(event.productionTitle);
  const extraTerms = parseExtraTerms(persona.extraTermsJson);

  return {
    eventId: event.id,
    eventTitle: event.title,
    kind: event.kind,
    productionTitle: event.productionTitle,
    announcedAt: event.announcedAt,
    daysSinceAnnouncement: daysSince(event.announcedAt, now),
    phase,
    characterAliases: characters,
    productionAliases: productions,
    compoundAliases: compoundAliases(persona.personName, characters),
    extraHashtags: vigilanceHashtags(
      { personName: persona.personName, characters, productions, extraTerms },
      phase
    ),
  };
}

/**
 * Talent ids with an open window, mapped to phase. Used by the cron to decide
 * who is due on a surge interval instead of their stored cadence.
 */
export async function talentsUnderVigilance(
  db: Db,
  now = Math.floor(Date.now() / 1000)
): Promise<Map<string, "peak" | "elevated">> {
  const rows = await db
    .select({
      talentId: monitorEventPersonas.talentId,
      personSlug: monitorEventPersonas.personSlug,
      announcedAt: monitorEvents.announcedAt,
      expiresAt: monitorEvents.expiresAt,
    })
    .from(monitorEventPersonas)
    .innerJoin(monitorEvents, eq(monitorEvents.id, monitorEventPersonas.eventId))
    .where(
      and(
        eq(monitorEventPersonas.active, true),
        eq(monitorEvents.status, "active"),
        gt(monitorEvents.expiresAt, now)
      )
    )
    .all();
  if (!rows.length) return new Map();

  const resolved = await resolveSlugsToTalent(db, new Set(rows.map((r) => r.personSlug)));
  const out = new Map<string, "peak" | "elevated">();

  for (const row of rows) {
    const talentId = row.talentId ?? resolved.get(row.personSlug)?.talentId;
    if (!talentId) continue;
    const phase = vigilancePhase(row.announcedAt, row.expiresAt, now);
    if (!phase) continue;
    // Peak beats elevated when two windows overlap — the tighter interval wins.
    if (out.get(talentId) === "peak") continue;
    out.set(talentId, phase);
  }
  return out;
}
