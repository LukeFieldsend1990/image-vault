/**
 * Announcement-driven vigilance.
 *
 * Synthetic likeness content is not evenly distributed in time. It arrives in
 * waves, and the waves are triggered: a casting announcement, a trailer drop, a
 * premiere. Within hours of a cast reveal the generators fire on exactly the
 * personas that were named, and they tag for reach — which during that window
 * means the *character* and the *production*, not the actor. A synthetic Cyclops
 * reel posted the day after a reveal is captioned "#cyclops #xmen fan concept",
 * and the actor's name may appear nowhere at all.
 *
 * That is the gap this module closes. A vigilance window attaches the persona
 * vocabulary — character aliases, production aliases, and the compound tags that
 * fuse actor and role — to a talent for a bounded period, so discovery asks for
 * the terms the wave actually uses and the pre-filter stops discarding hits that
 * never say the actor's name.
 *
 * Everything here is pure: parsing, alias derivation, query planning, matching,
 * and decay. The DB side (create / list / load) lives in lib/monitor/events.ts,
 * which keeps this module importable from the ingest layer without dragging a
 * D1 binding into it.
 *
 * Two guardrails are deliberate and load-bearing:
 *
 *   1. A character alias on its own is never an identity match. "Storm",
 *      "Rogue" and "Sinister" are ordinary English words; matching them alone
 *      would turn a weather clip into a likeness hit. An alias-only match needs
 *      corroboration — the production title alongside it, or a compound tag
 *      that fuses the actor's name to the role.
 *   2. A window raises the *prior*, never lowers the *bar*. The same
 *      announcement that triggers the synthetic wave also triggers a flood of
 *      legitimate press and studio material. Widening discovery is correct;
 *      relaxing the flag criteria during a window would flag the studio's own
 *      announcement post.
 */

import type { VigilanceAnchor, VigilancePhase } from "./types";
import { nameSlug, nameVariants } from "./ingest/queries";

/** What kicked the wave off. Kind is descriptive — it does not change thresholds. */
export type VigilanceEventKind =
  | "cast_announcement"
  | "trailer"
  | "premiere"
  | "festival"
  | "awards"
  | "other";

export const VIGILANCE_EVENT_KINDS: VigilanceEventKind[] = [
  "cast_announcement",
  "trailer",
  "premiere",
  "festival",
  "awards",
  "other",
];

/**
 * Days after the announcement that count as peak. Observed shape of these
 * waves: the bulk of generation lands inside the first fortnight while the
 * casting is still news, then settles into a long tail that never quite
 * returns to baseline because the character vocabulary now exists.
 */
export const PEAK_DAYS = 14;

/** Default life of a window before it stops steering sweeps. */
export const DEFAULT_WINDOW_DAYS = 60;

/** Extra discovery queries a window is allowed to add, by phase. */
const QUERY_BUDGET: Record<VigilancePhase, number> = { peak: 6, elevated: 3 };

/**
 * Sweep interval while a window is open, in seconds. A weekly monitor is the
 * wrong cadence for the week where the content is actually being made — by the
 * time a weekly sweep runs, a peak-phase reel has had six days of reach.
 */
const SURGE_INTERVAL_SECONDS: Record<VigilancePhase, number> = {
  peak: 43_200, // 12h
  elevated: 86_400, // 24h
};

const DAY = 86_400;

export interface PersonaInput {
  personName: string;
  characterName?: string | null;
  /** Operator-supplied extras: alternate spellings, fandom shorthand, arc names. */
  extraTerms?: string[];
}

export interface ParsedCastLine extends PersonaInput {
  characterName: string | null;
}

/**
 * Parse a pasted casting announcement into personas.
 *
 * The input is whatever the operator copied out of the trade story or the
 * studio post, which in practice is bullet-separated "Actor as Character" with
 * inconsistent line breaks, bullet glyphs and spacing. Anything that does not
 * carry an "as" separator is treated as a bare persona — an actor named with no
 * role attached is still worth watching.
 */
export function parseCastAnnouncement(text: string): ParsedCastLine[] {
  const out: ParsedCastLine[] = [];
  const seen = new Set<string>();

  const chunks = text
    .split(/[\n\r]+|[•·‣▪]|(?:\s+[|;]\s+)/)
    // Run-on lines are the norm in a pasted announcement — a missing bullet
    // glyph leaves "…Professor Charles Xavier Inde Navarrette as Anna Marie"
    // as one chunk, and a non-greedy "as" match would swallow the second
    // persona into the first one's role. Split again wherever a fresh
    // "Firstname Lastname as" begins.
    //
    // Exactly two capitalised words, not "one or more": a greedy version splits
    // "Professor Charles Xavier Inde Navarrette as" at the title instead of at
    // the actor. The cost is that a three-part actor name inside a run-on line
    // loses its first part — rarer, recoverable in the UI, and it still yields a
    // persona rather than swallowing one.
    .flatMap((line) => line.split(/(?<=\S)\s+(?=[A-Z][\p{L}'’-]+\s+[A-Z][\p{L}'’-]+\s+as\s)/gu))
    .map((s) => s.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    // "Kit Connor as Scott Summers/Cyclops" → person / character.
    const m = chunk.match(/^(.+?)\s+(?:as|plays|is|cast as)\s+(.+)$/i);
    // A chunk ending in a dangling "as" is the tail of a split that landed
    // mid-persona; keep the name rather than the artefact.
    const personName = (m ? m[1] : chunk)
      .replace(/^[-–—*\s]+/, "")
      .replace(/\s+as$/i, "")
      .trim();
    const characterName = m ? m[2].trim() : null;
    if (!personName || personName.length > 80) continue;
    // A person name is at least two words in practice; a single word here is
    // nearly always a fragment of the surrounding prose, not a cast member.
    if (!/\s/.test(personName)) continue;

    const key = nameSlug(personName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ personName, characterName });
  }

  return out;
}

/**
 * Split a character field into the aliases people actually tag.
 *
 * "Scott Summers/Cyclops" is two names for one role and both get used — the
 * civilian name in credits and fancasts, the code name everywhere else.
 */
export function characterAliases(characterName: string | null | undefined): string[] {
  if (!characterName) return [];
  const parts = characterName
    .split(/[/|,]|\s+(?:aka|a\.k\.a\.|alias)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = new Set<string>();
  for (const part of parts) {
    const cleaned = part
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    // Two characters is not a name, it is a stray initial.
    if (cleaned.length < 3) continue;
    out.add(cleaned);
    const slug = nameSlug(cleaned);
    if (slug.length >= 3) out.add(slug);
  }
  return [...out];
}

/** Production title → the spellings a caption or hashtag might carry. */
export function productionAliases(title: string | null | undefined): string[] {
  if (!title) return [];
  const cleaned = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return [];
  const out = new Set<string>([cleaned]);
  const slug = nameSlug(cleaned);
  if (slug.length >= 3) out.add(slug);
  // "X-Men" arrives as "x-men" and gets tagged "xmen"; the hyphen-stripped
  // form is the one that appears in hashtags.
  const dehyphenated = cleaned.replace(/-/g, "");
  if (dehyphenated.length >= 3) out.add(dehyphenated);
  return [...out];
}

/**
 * Tags that fuse the actor to the role ("kitconnorcyclops").
 *
 * These are the one class of vigilance term that identifies the target on its
 * own: nobody writes them by accident, and they are the native vocabulary of
 * fancast and recast accounts.
 */
export function compoundAliases(personName: string, characters: string[]): string[] {
  const person = nameSlug(personName);
  if (!person) return [];
  const out = new Set<string>();
  for (const c of characters) {
    const charSlug = nameSlug(c);
    if (charSlug.length < 3) continue;
    out.add(`${person}${charSlug}`);
    out.add(`${charSlug}${person}`);
  }
  return [...out];
}

/** How far into its life a window is. Null once it has run out. */
export function vigilancePhase(
  announcedAt: number,
  expiresAt: number,
  now: number
): VigilancePhase | null {
  if (now >= expiresAt) return null;
  return now - announcedAt <= PEAK_DAYS * DAY ? "peak" : "elevated";
}

export function daysSince(announcedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - announcedAt) / DAY));
}

/**
 * Hashtag values a window adds to a talent's sweep, ranked and capped.
 *
 * Ranking is by how self-identifying the term is, because the cap bites: the
 * compound tags first (they can only mean this actor in this role), then the
 * character-plus-AI tags (the wave's own vocabulary), then the production tags
 * (broadest reach, loosest relevance, and the ones the pre-filter will have to
 * work hardest on).
 */
export function vigilanceHashtags(
  input: {
    personName: string;
    characters: string[];
    productions: string[];
    extraTerms?: string[];
  },
  phase: VigilancePhase
): string[] {
  const ranked: string[] = [];
  const push = (value: string) => {
    const slug = nameSlug(value);
    if (slug.length >= 4 && !ranked.includes(slug)) ranked.push(slug);
  };

  const person = nameSlug(input.personName);
  const characters = characterSlugs(input.characters).slice(0, 2);
  const productions = [...new Set(input.productions.map(nameSlug))]
    .filter((p) => p.length >= 4)
    .slice(0, 1);

  // Tier 1 — can only mean this actor in this role.
  if (person) for (const c of characters) push(`${person}${c}`);
  // Tier 2 — the wave's own vocabulary.
  for (const c of characters) push(`${c}ai`);
  // Tier 3 — operator-supplied shorthand ("whitequeen"), which is usually a
  // narrower term than anything derivable from the announcement text.
  for (const t of input.extraTerms ?? []) push(t);
  // Tier 4 — production-wide. Broadest reach, loosest relevance, and the tags
  // the pre-filter works hardest on, so they go last but are not dropped: an
  // ensemble render is tagged for the film, not for one cast member.
  for (const p of productions) {
    push(`${p}ai`);
    push(`${p}deepfake`);
  }
  // Filler — reversed compounds. Real but rarer; only worth a query when the
  // budget is otherwise unspent.
  if (person) for (const c of characters) push(`${c}${person}`);

  return ranked.slice(0, QUERY_BUDGET[phase]);
}

/**
 * Character aliases as hashtag slugs, code name first.
 *
 * Announcements order a role civilian-name-first ("Scott Summers/Cyclops",
 * "Ororo Munroe/Storm") and it is the trailing code name that content is tagged
 * with, so the ordering is reversed against the cap.
 */
function characterSlugs(characters: string[]): string[] {
  const slugs = [...readableCharacters(characters)].reverse().map(nameSlug);
  return [...new Set(slugs)].filter((s) => s.length >= 4);
}

/**
 * Aliases with the slug spellings dropped. The slugs exist for hashtag
 * matching; in a phrase, or in prose shown to a human, they read as gibberish.
 */
function readableCharacters(characters: string[]): string[] {
  return characters.filter(
    (a) => !characters.some((o) => o !== a && o.includes(" ") && nameSlug(o) === a)
  );
}

/**
 * Free-text search phrases for the surfaces that accept them (TikTok, YouTube).
 *
 * Hashtags and phrases pull different content: a hashtag finds what the poster
 * chose to file under, a phrase finds what the platform's own ranking thinks the
 * clip is about. During a window the phrase form is the stronger of the two,
 * because "Kit Connor Cyclops" is unambiguous in a way that no single tag is.
 */
export function vigilancePhrases(
  fullName: string,
  v: Pick<VigilanceAnchor, "characterAliases" | "productionTitle" | "phase">,
  limit = QUERY_BUDGET[v.phase]
): string[] {
  const name = fullName.trim();
  // The trailing alias: announcements order a role civilian-name-first ("Scott
  // Summers/Cyclops", "Ororo Munroe/Storm") and it is the code name that content
  // is titled with.
  const readable = readableCharacters(v.characterAliases);
  const character = readable[readable.length - 1];
  if (!name || !character) return [];
  const production = v.productionTitle?.trim();

  const phrases = [
    `${name} ${character}`,
    production ? `${character} ${production} ai` : `${character} ai`,
    production ? `${production} ${character} concept trailer` : `${character} concept trailer`,
  ];
  return phrases.slice(0, Math.max(0, limit));
}

/**
 * Does this text implicate the persona under watch?
 *
 * Returns the matched term so callers can record *why* a candidate survived a
 * filter that its actor name alone would not have got it through — the
 * discovery source is the tuning signal for whether windows are earning their
 * spend.
 */
export function vigilanceMatch(
  haystack: string,
  v: Pick<VigilanceAnchor, "characterAliases" | "productionAliases" | "compoundAliases">
): { matched: true; term: string } | { matched: false; term: null } {
  const hay = haystack
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  for (const compound of v.compoundAliases) {
    if (compound.length >= 6 && hay.includes(compound)) return { matched: true, term: compound };
  }

  // Character alone is not identity — see guardrail 1 at the top of the file.
  const character = v.characterAliases.find((c) => hay.includes(c));
  if (!character) return { matched: false, term: null };
  const production = v.productionAliases.find((p) => hay.includes(p));
  if (!production) return { matched: false, term: null };
  return { matched: true, term: `${character}+${production}` };
}

/**
 * The identity gate used by the pre-filter: the talent's own name, or a
 * corroborated persona reference from an open window.
 */
export function identityTermMatch(
  haystack: string,
  fullName: string,
  vigilance?: VigilanceAnchor | null
): boolean {
  const hay = haystack
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const variants = nameVariants(fullName);
  if (variants.some((v) => hay.includes(v))) return true;
  if (!vigilance) return false;
  return vigilanceMatch(hay, vigilance).matched;
}

/** Seconds between sweeps while a window is open. */
export function surgeIntervalSeconds(phase: VigilancePhase): number {
  return SURGE_INTERVAL_SECONDS[phase];
}

/**
 * The block handed to the adjudicator.
 *
 * It states the window as context and then states its limit, because an LLM
 * told "expect a surge of synthetic content about this person" and nothing else
 * will happily flag the studio's own announcement reel.
 */
export function describeVigilance(v: VigilanceAnchor): string {
  const role = v.characterAliases.length ? ` as ${v.characterAliases[0]}` : "";
  const production = v.productionTitle ? ` in ${v.productionTitle}` : "";
  const when =
    v.daysSinceAnnouncement === 0
      ? "today"
      : v.daysSinceAnnouncement === 1
        ? "yesterday"
        : `${v.daysSinceAnnouncement} days ago`;

  return [
    `ACTIVE VIGILANCE WINDOW (${v.phase}): "${v.eventTitle}" — this talent was announced ${when}${role}${production}.`,
    `Announcements of this kind are followed by a surge of synthetic content pegged to the new role, tagged with the character and production rather than the actor's name (${[...v.compoundAliases, ...v.characterAliases].slice(0, 4).join(", ") || "n/a"}). Recast, fancast, "what if" and concept-trailer framing is the dominant format.`,
    `This raises the prior that a likeness reference is deliberate rather than incidental. It does NOT lower the evidence bar: a flag still requires BOTH a likeness claim AND synthetic or derived usage.`,
    `The same announcement produces a large volume of legitimate material — studio posts, trade coverage, press junkets, red carpet clips, official stills. Those must NOT be flagged, and are more common inside this window than outside it.`,
  ].join("\n");
}
