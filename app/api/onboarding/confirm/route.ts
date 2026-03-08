export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

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
      return NextResponse.json({ ok: true });
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

  return NextResponse.json({ ok: true });
}
