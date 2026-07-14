import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { productions, organisationMembers, talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";
import { canonicalCode } from "@/lib/codes/codes";
import { eq, and } from "drizzle-orm";

interface PlatformMatch {
  type: "platform";
  name: string;
  talentId: string;
  // Privacy: an existing talent's email is never returned to the producer — they
  // link by talentId. Doxxing a performer who hasn't engaged is not allowed.
  profilePath: string | null;
  tmdbId: number | null;
}

interface TmdbMatch {
  type: "tmdb";
  name: string;
  tmdbId: number;
  profilePath: string | null;
}

type CastMatch = PlatformMatch | TmdbMatch;

// Tiny Levenshtein edit distance (iterative, two-row).
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// GET /api/productions/[id]/cast/match?q=<name>
// Live name-matching for manual cast entry: existing ImageVault talent
// ("On ImageVault") plus near-name TMDB suggestions ("Did you mean…?").
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  const production = await db
    .select({ id: productions.id, organisationId: productions.organisationId })
    .from(productions)
    .where(eq(productions.id, id))
    .get();

  if (!production) {
    return NextResponse.json({ error: "Production not found" }, { status: 404 });
  }

  // Auth: admin, OR rep, OR industry-role org member of the production's org.
  if (!isAdmin(session.email)) {
    if (session.role === "rep") {
      // Reps may use the matcher.
    } else if (!isIndustryRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else if (production.organisationId) {
      const membership = await db
        .select({ memberRole: organisationMembers.memberRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, production.organisationId),
            eq(organisationMembers.userId, session.sub)
          )
        )
        .get();
      if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ matches: [] });

  const qNorm = q.toLowerCase();

  // PLATFORM MATCHES — existing ImageVault talent.
  const allProfiles = await db
    .select({
      userId: talentProfiles.userId,
      fullName: talentProfiles.fullName,
      tmdbId: talentProfiles.tmdbId,
      profileImageUrl: talentProfiles.profileImageUrl,
    })
    .from(talentProfiles)
    .all();

  // Score each profile: substring/startsWith preferred, then small edit distance.
  const scored = allProfiles
    .map((p) => {
      const nameNorm = p.fullName.trim().toLowerCase();
      let score: number | null = null;
      if (nameNorm.startsWith(qNorm) || qNorm.startsWith(nameNorm)) {
        score = 0;
      } else if (nameNorm.includes(qNorm) || qNorm.includes(nameNorm)) {
        score = 1;
      } else if (editDistance(nameNorm, qNorm) <= 2) {
        score = 2;
      }
      return score === null ? null : { profile: p, score };
    })
    .filter((x): x is { profile: typeof allProfiles[0]; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  const platformMatches: PlatformMatch[] = scored.map(({ profile }) => ({
    type: "platform",
    name: profile.fullName,
    talentId: profile.userId,
    profilePath: profile.profileImageUrl ?? null,
    tmdbId: profile.tmdbId ?? null,
  }));

  // A code-shaped query (AH-####) resolves a talent directly by system code —
  // surfaced at the top of the list (and deduped against any name match).
  const code = canonicalCode(q);
  if (code) {
    const u = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.shortCode, code), eq(users.role, "talent")))
      .get();
    if (u) {
      const prof = await db
        .select({ fullName: talentProfiles.fullName, profileImageUrl: talentProfiles.profileImageUrl, tmdbId: talentProfiles.tmdbId })
        .from(talentProfiles)
        .where(eq(talentProfiles.userId, u.id))
        .get();
      const existingIdx = platformMatches.findIndex((m) => m.talentId === u.id);
      if (existingIdx >= 0) {
        // Move the existing match to the front.
        platformMatches.unshift(platformMatches.splice(existingIdx, 1)[0]);
      } else {
        platformMatches.unshift({
          type: "platform",
          name: prof?.fullName ?? "Performer",
          talentId: u.id,
          profilePath: prof?.profileImageUrl ?? null,
          tmdbId: prof?.tmdbId ?? null,
        });
        if (platformMatches.length > 5) platformMatches.pop();
      }
    }
  }

  // Track what's already represented in the platform list to dedupe TMDB.
  const platformTmdbIds = new Set(
    platformMatches.map((m) => m.tmdbId).filter((t): t is number => t !== null)
  );
  const platformNames = new Set(platformMatches.map((m) => m.name.toLowerCase()));

  const matches: CastMatch[] = [...platformMatches];

  // TMDB SUGGESTIONS — typo catcher / fallback. Silent on missing key or failure.
  const tmdbKey = process.env.TMDB_API_KEY;
  if (tmdbKey && matches.length < 8) {
    try {
      const url = `https://api.themoviedb.org/3/search/person?api_key=${tmdbKey}&query=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{ id: number; name: string; profile_path?: string | null }>;
        };
        for (const r of (data.results ?? []).slice(0, 5)) {
          if (matches.length >= 8) break;
          if (platformTmdbIds.has(r.id)) continue;
          if (platformNames.has(r.name.toLowerCase())) continue;
          matches.push({
            type: "tmdb",
            name: r.name,
            tmdbId: r.id,
            profilePath: r.profile_path ?? null,
          });
        }
      }
    } catch {
      // Ignore TMDB failures — still return platform matches.
    }
  }

  return NextResponse.json({ matches });
}
