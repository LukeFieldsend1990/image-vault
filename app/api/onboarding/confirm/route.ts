import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { mintUserCode } from "@/lib/codes/codes";
import { findClaimableRoles } from "@/lib/productions/claim";
import { migrateTrialHitsToTalent } from "@/lib/monitor/trial";
import { eq } from "drizzle-orm";

// Image Scout follow-through: any completed trial sweeps that scouted this
// TMDB person now belong in the new talent's real monitor. Fire-and-forget so
// onboarding never waits on it; the migration is idempotent.
function transferTrialHits(db: ReturnType<typeof getDb>, userId: string, tmdbId: number | undefined) {
  if (!tmdbId) return;
  void (async () => {
    try {
      const { trialsConverted, hitsMigrated } = await migrateTrialHitsToTalent(db, userId, tmdbId);
      if (trialsConverted > 0) {
        console.log(
          `[trial] onboarding transfer for ${userId}: ${hitsMigrated} hit(s) from ${trialsConverted} trial(s)`
        );
      }
    } catch (err) {
      console.warn(`[trial] onboarding transfer failed for ${userId}: ${(err as Error).message}`);
    }
  })();
}

// Strong (tmdbId) matches are safe to surface proactively at the end of
// onboarding; name-only matches are left for the dashboard card where the talent
// confirms explicitly.
async function tmdbClaimable(db: ReturnType<typeof getDb>, userId: string) {
  const roles = await findClaimableRoles(db, userId);
  return roles.filter((r) => r.matchType === "tmdb");
}

interface ConfirmBody {
  skip?: boolean;
  fullName?: string;
  tmdbId?: number;
  profileImageUrl?: string;
  knownFor?: Array<{ title: string; year: string; type: string }>;
  popularity?: number;
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts use onboarding" }, { status: 403 });
  }

  let body: ConfirmBody;
  try {
    body = JSON.parse(await req.text()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Idempotent — update if row already exists
  const existing = await db
    .select({ userId: talentProfiles.userId })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, session.sub))
    .get();

  if (existing) {
    // Update is allowed — if not a skip and fullName is provided, overwrite the profile
    if (!body.skip && body.fullName?.trim()) {
      await db.update(talentProfiles).set({
        fullName: body.fullName.trim(),
        tmdbId: body.tmdbId ?? null,
        profileImageUrl: body.profileImageUrl ?? null,
        knownFor: JSON.stringify(body.knownFor ?? []),
        popularity: body.popularity ?? null,
      }).where(eq(talentProfiles.userId, session.sub));
      transferTrialHits(db, session.sub, body.tmdbId);
      return NextResponse.json({ ok: true, claimable: await tmdbClaimable(db, session.sub) });
    }
    return NextResponse.json({ ok: true, alreadyOnboarded: true });
  }

  if (body.skip) {
    // Derive a fallback name from email
    const user = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, session.sub))
      .get();

    const fallbackName = user?.email.split("@")[0] ?? "Talent";

    await db.insert(talentProfiles).values({
      userId: session.sub,
      fullName: fallbackName,
      tmdbId: null,
      profileImageUrl: null,
      knownFor: "[]",
      popularity: null,
      onboardedAt: now,
    });

    await mintUserCode(db, session.sub, "talent");
    return NextResponse.json({ ok: true });
  }

  if (!body.fullName?.trim()) {
    return NextResponse.json({ error: "fullName is required" }, { status: 400 });
  }

  await db.insert(talentProfiles).values({
    userId: session.sub,
    fullName: body.fullName.trim(),
    tmdbId: body.tmdbId ?? null,
    profileImageUrl: body.profileImageUrl ?? null,
    knownFor: JSON.stringify(body.knownFor ?? []),
    popularity: body.popularity ?? null,
    onboardedAt: now,
  });

  await mintUserCode(db, session.sub, "talent");
  transferTrialHits(db, session.sub, body.tmdbId);
  return NextResponse.json({ ok: true, claimable: await tmdbClaimable(db, session.sub) });
}
