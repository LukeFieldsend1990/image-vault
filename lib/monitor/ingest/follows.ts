/**
 * Curation-account import.
 *
 * The pattern: a human uses Instagram's own search — which finds this content
 * easily and which no API exposes to us — and simply *follows* every offender
 * they come across. That following list is then imported as the watchlist.
 *
 * It puts each side on the job it is good at. Judgement ("is this a synthetic
 * likeness account?") stays with a person using a native UI; volume ("harvest
 * every post from these 200 accounts, forever, and name-match them against the
 * whole roster") goes to the machine. It also degrades honestly: if the
 * follows scrape breaks, the same list can be pasted in by hand and nothing
 * downstream notices the difference.
 *
 * Caveat worth stating plainly: a following list is semi-private data, and
 * actors that read it generally need an authenticated session. The actor id is
 * therefore configurable at runtime rather than compiled in — we have already
 * had two Instagram actors change behaviour under us, and swapping one should
 * not need a deploy.
 */

import { getDb } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ApifyError, runActor } from "./apify";

type Db = ReturnType<typeof getDb>;

export const FOLLOWS_ACTOR_KEY = "apify_follows_actor";
export const CURATION_HANDLE_KEY = "monitor_curation_handle";

/** Default follows actor. Overridable from /admin/monitor without a deploy. */
export const DEFAULT_FOLLOWS_ACTOR = "apify~instagram-followers-scraper";

export interface ImportedAccount {
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  verified: boolean;
}

interface FollowItem {
  username?: string;
  fullName?: string;
  full_name?: string;
  followersCount?: number;
  isVerified?: boolean;
  is_verified?: boolean;
}

export async function readSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.select({ value: aiSettings.value }).from(aiSettings).where(eq(aiSettings.key, key)).get();
  return row?.value ?? null;
}

/** Normalise anything a human might paste into a bare handle. */
export function normaliseHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept full URLs, @handles, or bare handles.
  const urlMatch = trimmed.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const candidate = (urlMatch ? urlMatch[1] : trimmed).replace(/^@/, "").replace(/\/$/, "").toLowerCase();

  // Instagram handles: letters, digits, periods, underscores, max 30.
  if (!/^[a-z0-9._]{1,30}$/.test(candidate)) return null;
  // Reserved paths that turn up when someone pastes a link to a post.
  if (["p", "reel", "reels", "explore", "stories", "tv"].includes(candidate)) return null;
  return candidate;
}

/**
 * Parse a pasted block into handles. Always available, and the fallback
 * whenever the follows scrape is unavailable — which, given the state of
 * Instagram actors, should be assumed to be often.
 */
export function parseHandleList(text: string): { handles: string[]; rejected: string[] } {
  const handles: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/[\n,;]+/)) {
    const raw = line.trim();
    if (!raw) continue;
    const handle = normaliseHandle(raw);
    if (!handle) {
      rejected.push(raw.slice(0, 60));
    } else if (!seen.has(handle)) {
      seen.add(handle);
      handles.push(handle);
    }
  }

  return { handles, rejected };
}

export interface FollowsImportResult {
  accounts: ImportedAccount[];
  error: string | null;
}

/**
 * Read the accounts a curation handle follows.
 *
 * Returns an error string rather than throwing: the admin screen offers a
 * paste box alongside this, so a failure here should present as "use the other
 * route" rather than as a broken page.
 */
export async function fetchFollowing(opts: {
  token: string;
  handle: string;
  limit?: number;
  actorId?: string;
  signal?: AbortSignal;
}): Promise<FollowsImportResult> {
  const handle = normaliseHandle(opts.handle);
  if (!handle) return { accounts: [], error: "That does not look like an Instagram handle." };

  const actorId = opts.actorId ?? DEFAULT_FOLLOWS_ACTOR;
  const limit = opts.limit ?? 200;

  try {
    const run = await runActor<FollowItem>({
      token: opts.token,
      actorId,
      input: {
        usernames: [handle],
        // Actor input shapes vary; sending both spellings costs nothing and
        // saves a round of trial and error when swapping actors.
        username: [handle],
        resultsLimit: limit,
        maxItems: limit,
        whatToScrape: "following",
      },
      maxItems: limit,
      signal: opts.signal,
    });

    const seen = new Set<string>();
    const accounts: ImportedAccount[] = [];
    for (const item of run.items) {
      const name = normaliseHandle(item.username ?? "");
      if (!name || name === handle || seen.has(name)) continue;
      seen.add(name);
      accounts.push({
        handle: name,
        displayName: item.fullName ?? item.full_name ?? null,
        followerCount: typeof item.followersCount === "number" ? item.followersCount : null,
        verified: item.isVerified === true || item.is_verified === true,
      });
    }

    if (!accounts.length) {
      return {
        accounts: [],
        error:
          "The actor ran but returned no accounts. Following lists usually need an authenticated session — " +
          "try a different actor in settings, or paste the handles instead.",
      };
    }

    return { accounts, error: null };
  } catch (err) {
    const reason = err instanceof ApifyError ? err.reason : "unknown";
    return {
      accounts: [],
      error:
        reason === "auth"
          ? "Apify rejected the token for this actor."
          : `Follows import failed (${reason}). Paste the handles instead, or change the actor in settings.`,
    };
  }
}
