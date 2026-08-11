/**
 * Seeded AI-content accounts.
 *
 * The third discovery surface, and the one that follows directly from what the
 * first live checks showed: this content clusters on a relatively small number
 * of prolific accounts that publish nothing else. @leakingai's synthetic Venom
 * trailer had 27k plays and zero hashtags — unfindable by tag, trivially
 * findable by watching the account.
 *
 * Economically this is the cheapest surface per useful hit. One harvest of one
 * account returns dozens of posts, all of which get name-matched against the
 * *entire* roster rather than one talent — so like the roster hashtag sweep,
 * its cost divides across every monitored person instead of multiplying.
 *
 * These are starting points discovered by hand, not an allowlist or an
 * accusation: an account appearing here means "worth looking at", and every
 * post it publishes still goes through the same pre-filter and adjudicator as
 * anything else. Nothing is flagged for being on this list.
 */

export interface SeedAccount {
  platform: "instagram" | "tiktok" | "youtube";
  handle: string;
  /** Why it is worth watching — kept so the list can be pruned on evidence. */
  note: string;
}

export const SEED_AI_ACCOUNTS: SeedAccount[] = [
  {
    platform: "instagram",
    handle: "leakingai",
    note: "88.5k followers. Posted the synthetic Venom 4 trailer using Tom Hardy's likeness — 27k plays, no hashtags at all.",
  },
  {
    platform: "instagram",
    handle: "ultimatestudiosofficial",
    note: "997k followers, verified. AI concept trailers tagged with cast names (#tomhardy) rather than AI tags.",
  },
];

// A handle read off branding burnt into a video ("Reveal.Ai" → reveal.aii) was
// seeded here and did not exist; the posting account was leakingai. Every entry
// above is now confirmed against the platform, and /admin/monitor has a Verify
// action so the same mistake surfaces in seconds rather than as a watchlist
// entry that is swept forever and never matches anything.

export function seedHandlesFor(platform: SeedAccount["platform"]): string[] {
  return SEED_AI_ACCOUNTS.filter((a) => a.platform === platform).map((a) => a.handle);
}
