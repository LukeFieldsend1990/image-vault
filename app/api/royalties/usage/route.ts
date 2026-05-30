export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, talentSettings, usageEvents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRoyaltySource, isRoyaltySourceError } from "@/lib/auth/requireRoyaltySource";
import { checkRateLimit } from "@/lib/auth/rateLimit";
import { computeRoyalty, DEFAULT_SPLIT, type SplitPcts } from "@/lib/royalties/split";

const AI_LICENCE_TYPES = new Set(["ai_avatar", "training_data"]);

interface UsageBody {
  externalRef?: string;
  units?: number;
  eventType?: string;
  occurredAt?: number;
  detail?: unknown;
}

// POST /api/royalties/usage — studio / AI company reports a likeness-generation event.
export async function POST(req: NextRequest) {
  const auth = await requireRoyaltySource(req);
  if (isRoyaltySourceError(auth)) return auth;

  // Machine traffic — generous ceiling, keyed on the source.
  const rl = await checkRateLimit(auth.sourceId, {
    action: "royalty_usage",
    maxAttempts: 600,
    windowSeconds: 60,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: UsageBody;
  try {
    body = (await req.json()) as UsageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const units = Math.floor(Number(body.units));
  if (!Number.isFinite(units) || units <= 0) {
    return NextResponse.json({ error: "units must be a positive integer" }, { status: 400 });
  }

  const db = getDb();

  // Validate the licence is approved and AI-bearing.
  const licence = await db
    .select({
      status: licences.status,
      licenceType: licences.licenceType,
      permitAiTraining: licences.permitAiTraining,
    })
    .from(licences)
    .where(eq(licences.id, auth.licenceId))
    .get();

  if (!licence) {
    return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  }
  if (licence.status !== "APPROVED") {
    return NextResponse.json({ error: "Licence is not active" }, { status: 409 });
  }
  const aiBearing =
    (licence.licenceType !== null && AI_LICENCE_TYPES.has(licence.licenceType)) ||
    licence.permitAiTraining;
  if (!aiBearing) {
    return NextResponse.json(
      { error: "Licence does not permit AI/likeness generation" },
      { status: 403 },
    );
  }

  // Idempotency — a replay of the same generation id is a no-op.
  const externalRef = typeof body.externalRef === "string" ? body.externalRef.trim() : "";
  if (externalRef) {
    const existing = await db
      .select({ id: usageEvents.id, talentPence: usageEvents.talentPence, grossPence: usageEvents.grossPence })
      .from(usageEvents)
      .where(and(eq(usageEvents.sourceId, auth.sourceId), eq(usageEvents.externalRef, externalRef)))
      .get();
    if (existing) {
      return NextResponse.json(
        { ok: true, deduped: true, eventId: existing.id, grossPence: existing.grossPence, talentPence: existing.talentPence },
        { status: 200 },
      );
    }
  }

  // Resolve the talent's split (fall back to defaults if unset).
  const settings = await db
    .select({
      talentSharePct: talentSettings.talentSharePct,
      agencySharePct: talentSettings.agencySharePct,
      platformSharePct: talentSettings.platformSharePct,
    })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, auth.talentId))
    .get();
  const pcts: SplitPcts = settings ?? DEFAULT_SPLIT;

  const split = computeRoyalty(units, auth.unitRatePence, pcts);
  const now = Math.floor(Date.now() / 1000);
  const occurredAt = Number.isFinite(Number(body.occurredAt)) ? Math.floor(Number(body.occurredAt)) : now;
  const eventType = typeof body.eventType === "string" && body.eventType ? body.eventType : auth.unitType;

  let detailJson: string | null = null;
  if (body.detail !== undefined && body.detail !== null) {
    try {
      detailJson = JSON.stringify(body.detail).slice(0, 4000);
    } catch {
      detailJson = null;
    }
  }

  const eventId = crypto.randomUUID();
  await db
    .insert(usageEvents)
    .values({
      id: eventId,
      sourceId: auth.sourceId,
      licenceId: auth.licenceId,
      talentId: auth.talentId,
      eventType,
      units,
      unitRatePence: auth.unitRatePence,
      grossPence: split.grossPence,
      talentPence: split.talentPence,
      agencyPence: split.agencyPence,
      platformPence: split.platformPence,
      externalRef: externalRef || null,
      detailJson,
      occurredAt,
      recordedAt: now,
    })
    .onConflictDoNothing();

  return NextResponse.json(
    { ok: true, eventId, grossPence: split.grossPence, talentPence: split.talentPence },
    { status: 201 },
  );
}
