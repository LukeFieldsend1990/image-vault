import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isScoutRole } from "@/lib/auth/roles";
import {
  createTrialDraft,
  getTrialQuota,
  isTrialFeatureEnabled,
  listTrials,
} from "@/lib/monitor/trial";

// GET /api/scout — the requester's trials plus their run quota. Admin
// accounts see the surface regardless of the feature toggle and run
// uncapped: the owner testing the product is not a lead to meter.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }
  const admin = session.role === "admin" || isAdmin(session.email);

  const db = getDb();
  const [enabled, quota, trials] = await Promise.all([
    isTrialFeatureEnabled(db),
    getTrialQuota(db, session.sub),
    listTrials(db, session.sub),
  ]);
  return NextResponse.json({
    enabled: enabled || admin,
    quota,
    trials,
    unlimited: admin,
  });
}

interface CreateBody {
  tmdbId?: number;
  name?: string;
  profileImageUrl?: string | null;
  knownFor?: Array<{ title: string; year: string; type: string }>;
  popularity?: number | null;
}

// POST /api/scout — open a draft trial for a TMDB subject. Drafts are free;
// the quota is spent when the sweep launches.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isScoutRole(session.role) && !isAdmin(session.email)) {
    return NextResponse.json({ error: "Trial sweeps are for rep and production accounts" }, { status: 403 });
  }

  const db = getDb();
  const admin = session.role === "admin" || isAdmin(session.email);
  if (!admin && !(await isTrialFeatureEnabled(db))) {
    return NextResponse.json({ error: "Trial sweeps are currently disabled" }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = JSON.parse(await req.text()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Number.isInteger(body.tmdbId) || (body.tmdbId as number) <= 0) {
    return NextResponse.json({ error: "tmdbId is required" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { trialId, reused } = await createTrialDraft(db, session.sub, {
    tmdbId: body.tmdbId as number,
    name: name.slice(0, 200),
    profileImageUrl: typeof body.profileImageUrl === "string" ? body.profileImageUrl : null,
    knownFor: Array.isArray(body.knownFor)
      ? body.knownFor
          .filter((k): k is { title: string; year: string; type: string } => !!k && typeof k === "object")
          .slice(0, 5)
          .map((k) => ({
            title: String(k.title ?? "").slice(0, 200),
            year: String(k.year ?? "").slice(0, 4),
            type: k.type === "tv" ? "tv" : "movie",
          }))
      : [],
    popularity: typeof body.popularity === "number" ? body.popularity : null,
  });

  return NextResponse.json({ trialId, reused }, { status: reused ? 200 : 201 });
}
