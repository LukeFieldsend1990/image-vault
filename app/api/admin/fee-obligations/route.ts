import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { feeObligations, talentSettings, licences, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import {
  isTalentTier, isProductionBand, tierDef, bandDef, DEFAULT_GRACE_DAYS, CURRENCY,
} from "@/lib/financial/config";
import { eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

const payer = alias(users, "payer");
const talent = alias(users, "talent");

// GET /api/admin/fee-obligations — list obligations with subject labels
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const rows = await db
    .select({
      id: feeObligations.id,
      type: feeObligations.type,
      tier: feeObligations.tier,
      band: feeObligations.band,
      amountCents: feeObligations.amountCents,
      currency: feeObligations.currency,
      status: feeObligations.status,
      graceDeadline: feeObligations.graceDeadline,
      notes: feeObligations.notes,
      createdAt: feeObligations.createdAt,
      paidAt: feeObligations.paidAt,
      payerEmail: payer.email,
      talentEmail: talent.email,
      projectName: licences.projectName,
    })
    .from(feeObligations)
    .leftJoin(payer, eq(payer.id, feeObligations.payerUserId))
    .leftJoin(talent, eq(talent.id, feeObligations.talentId))
    .leftJoin(licences, eq(licences.id, feeObligations.licenceId))
    .orderBy(desc(feeObligations.createdAt))
    .all();

  return NextResponse.json({ obligations: rows });
}

// POST /api/admin/fee-obligations — record a tier fee or a production access fee
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: {
    type?: string;
    talentId?: string;
    licenceId?: string;
    tier?: string;
    band?: string;
    amountCents?: number | null;
    graceDays?: number;
    notes?: string;
  };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const graceDays = typeof body.graceDays === "number" ? body.graceDays : DEFAULT_GRACE_DAYS;
  const graceDeadline = graceDays > 0 ? now + graceDays * 86400 : null;

  let amountCents: number | null;
  let talentId: string | null = null;
  let payerUserId: string | null = null;
  let productionId: string | null = null;
  let licenceId: string | null = null;
  let tier: string | null = null;
  let band: string | null = null;

  if (body.type === "talent_tier") {
    if (!body.talentId || !isTalentTier(body.tier)) {
      return NextResponse.json({ error: "talentId and a valid tier are required" }, { status: 400 });
    }
    tier = body.tier;
    talentId = body.talentId;
    payerUserId = body.talentId; // reps act on the talent's behalf
    amountCents = body.amountCents ?? tierDef(tier)?.amountCents ?? null;

    // Recording a tier fee also assigns the talent's current tier.
    const existing = await db.select({ talentId: talentSettings.talentId }).from(talentSettings).where(eq(talentSettings.talentId, talentId)).get();
    if (existing) {
      await db.update(talentSettings).set({ tier, updatedBy: session.sub, updatedAt: now }).where(eq(talentSettings.talentId, talentId));
    } else {
      await db.insert(talentSettings).values({ talentId, tier, updatedBy: session.sub, updatedAt: now });
    }
  } else if (body.type === "production_access") {
    if (!body.licenceId || !isProductionBand(body.band)) {
      return NextResponse.json({ error: "licenceId and a valid band are required" }, { status: 400 });
    }
    const licence = await db
      .select({ id: licences.id, licenseeId: licences.licenseeId, productionId: licences.productionId })
      .from(licences)
      .where(eq(licences.id, body.licenceId))
      .get();
    if (!licence) return NextResponse.json({ error: "Licence not found" }, { status: 404 });
    band = body.band;
    licenceId = licence.id;
    productionId = licence.productionId;
    payerUserId = licence.licenseeId;
    amountCents = body.amountCents ?? bandDef(band)?.amountCents ?? null;
  } else {
    return NextResponse.json({ error: "type must be talent_tier or production_access" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  await db.insert(feeObligations).values({
    id, type: body.type as "talent_tier" | "production_access",
    payerUserId, talentId, productionId, licenceId, tier, band,
    amountCents, currency: CURRENCY, status: "pending", graceDeadline,
    notes: body.notes?.trim() || null, createdBy: session.sub, createdAt: now,
  });

  return NextResponse.json({ id }, { status: 201 });
}
