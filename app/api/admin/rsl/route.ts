import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { rslProfiles, users, talentProfiles } from "@/lib/db/schema";
import { derivePosture } from "@/lib/rsl/posture";
import { consentProfileUrl } from "@/lib/rsl/profile";
import { generateSlug, isPublic } from "@/lib/rsl/visibility";

/**
 * Admin master switch for public RSL profiles. Even when a talent has opted in,
 * nothing is served publicly until an admin approves it here. Approving mints
 * the unguessable slug; revoking retires it so the old URL 404s.
 */

// GET /api/admin/rsl — every talent who has opted in (the review queue).
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const rows = await db
    .select({
      talentId: rslProfiles.talentId,
      email: users.email,
      vaultLocked: users.vaultLocked,
      fullName: talentProfiles.fullName,
      publishOptIn: rslProfiles.publishOptIn,
      adminApproved: rslProfiles.adminApproved,
      publicSlug: rslProfiles.publicSlug,
      displayName: rslProfiles.displayName,
      profession: rslProfiles.profession,
      approvedAt: rslProfiles.approvedAt,
      updatedAt: rslProfiles.updatedAt,
    })
    .from(rslProfiles)
    .innerJoin(users, eq(users.id, rslProfiles.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, rslProfiles.talentId))
    .where(eq(rslProfiles.publishOptIn, true))
    .all();

  const items = [];
  for (const r of rows) {
    const posture = await derivePosture(db, r.talentId);
    const live = isPublic({
      publishOptIn: r.publishOptIn,
      adminApproved: r.adminApproved,
      publicSlug: r.publicSlug,
      vaultLocked: !!r.vaultLocked,
    });
    items.push({
      talentId: r.talentId,
      email: r.email,
      name: r.displayName || r.fullName || r.email,
      profession: r.profession,
      vaultLocked: !!r.vaultLocked,
      adminApproved: r.adminApproved,
      overall: posture.overall,
      live,
      publicUrl: live && r.publicSlug ? consentProfileUrl(r.publicSlug) : null,
      approvedAt: r.approvedAt,
      updatedAt: r.updatedAt,
    });
  }
  // Pending (not yet approved) first.
  items.sort((a, b) => Number(a.adminApproved) - Number(b.adminApproved));
  return NextResponse.json({ items });
}

// POST /api/admin/rsl — { talentId, action: "approve" | "revoke" }
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { talentId?: unknown; action?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const talentId = typeof body.talentId === "string" ? body.talentId : null;
  const action = body.action === "approve" || body.action === "revoke" ? body.action : null;
  if (!talentId || !action) {
    return NextResponse.json({ error: "talentId and action (approve|revoke) required" }, { status: 400 });
  }

  const db = getDb();
  const profile = await db.select().from(rslProfiles).where(eq(rslProfiles.talentId, talentId)).get();
  if (!profile) return NextResponse.json({ error: "No RSL profile for that talent" }, { status: 404 });

  const now = Math.floor(Date.now() / 1000);
  if (action === "approve") {
    if (!profile.publishOptIn) {
      return NextResponse.json({ error: "Talent has not opted in to publish" }, { status: 409 });
    }
    await db
      .update(rslProfiles)
      .set({
        adminApproved: true,
        approvedBy: session.sub,
        approvedAt: now,
        publicSlug: profile.publicSlug ?? generateSlug(),
        updatedAt: now,
      })
      .where(eq(rslProfiles.talentId, talentId));
  } else {
    // Revoke: flip the master switch off and retire the slug so the URL dies.
    await db
      .update(rslProfiles)
      .set({ adminApproved: false, publicSlug: null, approvedBy: null, approvedAt: null, updatedAt: now })
      .where(eq(rslProfiles.talentId, talentId));
  }

  return NextResponse.json({ ok: true });
}
