export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { royaltySources, licences } from "@/lib/db/schema";
import { and, or, eq, inArray } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { canManageLicenceRoyalties } from "@/lib/royalties/access";
import { generateRoyaltyKey, sha256Hex } from "@/lib/auth/requireRoyaltySource";

const UNIT_TYPES = new Set(["per_generation", "per_1k_inferences", "per_frame", "per_second"]);

// GET /api/royalties/sources — list royalty sources the caller can see.
// Optional ?licenceId= to scope to one licence.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const licenceId = req.nextUrl.searchParams.get("licenceId");

  if (licenceId) {
    const access = await canManageLicenceRoyalties(session, licenceId);
    if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const sources = await listSources(db, [licenceId]);
    return NextResponse.json({ sources, eligibleLicences: await eligibleLicences(db, [licenceId]) });
  }

  // No licence filter — resolve the set of licences the caller may manage.
  const licenceIds = await accessibleLicenceIds(db, session);
  const sources = licenceIds.length ? await listSources(db, licenceIds) : [];
  const eligible = licenceIds.length ? await eligibleLicences(db, licenceIds) : [];
  return NextResponse.json({ sources, eligibleLicences: eligible });
}

// APPROVED + AI-bearing licences a royalty source can be attached to.
async function eligibleLicences(db: ReturnType<typeof getDb>, licenceIds: string[]) {
  return db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      licenceType: licences.licenceType,
    })
    .from(licences)
    .where(
      and(
        inArray(licences.id, licenceIds),
        eq(licences.status, "APPROVED"),
        or(
          inArray(licences.licenceType, ["ai_avatar", "training_data"]),
          eq(licences.permitAiTraining, true),
        ),
      ),
    )
    .all();
}

// POST /api/royalties/sources — issue a new royalty source key for a licence.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { licenceId?: string; displayName?: string; unitType?: string; unitRatePence?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const licenceId = (body.licenceId ?? "").trim();
  const displayName = (body.displayName ?? "").trim();
  const unitType = (body.unitType ?? "per_generation").trim();
  const unitRatePence = Math.floor(Number(body.unitRatePence));

  if (!licenceId) return NextResponse.json({ error: "licenceId is required" }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "displayName is required" }, { status: 400 });
  if (displayName.length > 120) return NextResponse.json({ error: "displayName too long" }, { status: 400 });
  if (!UNIT_TYPES.has(unitType)) return NextResponse.json({ error: "Invalid unitType" }, { status: 400 });
  if (!Number.isFinite(unitRatePence) || unitRatePence <= 0) {
    return NextResponse.json({ error: "unitRatePence must be a positive integer" }, { status: 400 });
  }

  const access = await canManageLicenceRoyalties(session, licenceId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rawKey = generateRoyaltyKey();
  const apiKeyHash = await sha256Hex(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  const db = getDb();

  // Carry the licence's org scope onto the source for downstream reporting.
  const lic = await db
    .select({ organisationId: licences.organisationId })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  await db.insert(royaltySources).values({
    id,
    licenceId,
    organisationId: lic?.organisationId ?? null,
    displayName,
    apiKeyHash,
    unitType: unitType as "per_generation" | "per_1k_inferences" | "per_frame" | "per_second",
    unitRatePence,
    status: "active",
    createdAt: now,
    createdBy: session.sub,
  });

  // Return the raw key once — it cannot be retrieved again.
  return NextResponse.json({ id, key: rawKey, displayName }, { status: 201 });
}

async function listSources(db: ReturnType<typeof getDb>, licenceIds: string[]) {
  return db
    .select({
      id: royaltySources.id,
      licenceId: royaltySources.licenceId,
      displayName: royaltySources.displayName,
      unitType: royaltySources.unitType,
      unitRatePence: royaltySources.unitRatePence,
      status: royaltySources.status,
      lastUsedAt: royaltySources.lastUsedAt,
      createdAt: royaltySources.createdAt,
      revokedAt: royaltySources.revokedAt,
    })
    .from(royaltySources)
    .where(inArray(royaltySources.licenceId, licenceIds))
    .all();
}

async function accessibleLicenceIds(
  db: ReturnType<typeof getDb>,
  session: { sub: string; email: string; role: string },
): Promise<string[]> {
  if (isAdmin(session.email)) {
    const rows = await db.select({ id: licences.id }).from(licences).all();
    return rows.map((r) => r.id);
  }
  // Own licences (talent).
  const own = await db
    .select({ id: licences.id })
    .from(licences)
    .where(eq(licences.talentId, session.sub))
    .all();
  return own.map((r) => r.id);
}
