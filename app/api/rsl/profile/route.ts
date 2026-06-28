import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { rslProfiles, users } from "@/lib/db/schema";
import {
  ensureRslProfile,
  getRslProfile,
  parseLinks,
  consentProfileUrl,
  type PublicLink,
} from "@/lib/rsl/profile";
import { derivePosture } from "@/lib/rsl/posture";
import { isPublic } from "@/lib/rsl/visibility";

/**
 * The talent's own RSL consent-profile controls. A talent manages only their
 * own profile here; an admin manages publication (approve/revoke + slug) via
 * /api/admin/rsl. Opting in NEVER auto-publishes — admin approval is required.
 */

function viewModel(
  profile: Awaited<ReturnType<typeof getRslProfile>>,
  vaultLocked: boolean,
  posture: Awaited<ReturnType<typeof derivePosture>>,
) {
  const p = profile!;
  const live = isPublic({
    publishOptIn: p.publishOptIn,
    adminApproved: p.adminApproved,
    publicSlug: p.publicSlug,
    vaultLocked,
  });
  let status: "not_published" | "awaiting_approval" | "live" | "blocked_vault_locked";
  if (live) status = "live";
  else if (p.publishOptIn && p.adminApproved && vaultLocked) status = "blocked_vault_locked";
  else if (p.publishOptIn && !p.adminApproved) status = "awaiting_approval";
  else status = "not_published";

  return {
    publishOptIn: p.publishOptIn,
    adminApproved: p.adminApproved,
    displayName: p.displayName,
    profession: p.profession,
    links: parseLinks(p.linksJson),
    humanConsentId: p.humanConsentId,
    status,
    publicUrl: live && p.publicSlug ? consentProfileUrl(p.publicSlug) : null,
    posture,
  };
}

// GET /api/rsl/profile — the caller's own profile + derived posture.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const profile = await ensureRslProfile(db, session.sub);
  const userRow = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  const posture = await derivePosture(db, session.sub);
  return NextResponse.json(viewModel(profile, !!userRow?.vaultLocked, posture));
}

// PATCH /api/rsl/profile — update own opt-in + public-card fields.
// Body: { publishOptIn?, displayName?, profession?, links? }
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: {
    publishOptIn?: unknown;
    displayName?: unknown;
    profession?: unknown;
    links?: unknown;
  } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  await ensureRslProfile(db, session.sub);

  const updates: Partial<typeof rslProfiles.$inferInsert> = {
    updatedAt: Math.floor(Date.now() / 1000),
  };
  if (typeof body.publishOptIn === "boolean") updates.publishOptIn = body.publishOptIn;
  if (typeof body.displayName === "string") updates.displayName = body.displayName.trim().slice(0, 120) || null;
  if (typeof body.profession === "string") updates.profession = body.profession.trim().slice(0, 120) || null;
  if (Array.isArray(body.links)) {
    const links: PublicLink[] = [];
    for (const l of body.links) {
      if (l && typeof l.label === "string" && typeof l.url === "string") {
        const url = l.url.trim();
        // Only http(s) links on a public surface.
        if (/^https?:\/\//i.test(url)) {
          links.push({ label: l.label.trim().slice(0, 80), url: url.slice(0, 300) });
        }
      }
      if (links.length >= 8) break;
    }
    updates.linksJson = links.length ? JSON.stringify(links) : null;
  }

  await db.update(rslProfiles).set(updates).where(eq(rslProfiles.talentId, session.sub));

  const profile = await getRslProfile(db, session.sub);
  const userRow = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  const posture = await derivePosture(db, session.sub);
  return NextResponse.json({ ok: true, ...viewModel(profile, !!userRow?.vaultLocked, posture) });
}
