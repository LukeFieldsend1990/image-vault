import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { royaltySources, talentSettings, usageEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canManageLicenceRoyalties } from "@/lib/royalties/access";
import { computeRoyalty, DEFAULT_SPLIT, type SplitPcts } from "@/lib/royalties/split";

/**
 * POST /api/royalties/demo/fire — fire N synthetic usage events against a source
 * so the Royalty Hub visibly ticks during a pitch. Session-guarded: the caller
 * must be able to manage the source's licence. Demo-only, not part of the
 * external ingest path.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { sourceId?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceId = (body.sourceId ?? "").trim();
  const count = Math.min(20, Math.max(1, Math.floor(Number(body.count) || 1)));
  if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });

  const db = getDb();
  const source = await db
    .select({
      id: royaltySources.id,
      licenceId: royaltySources.licenceId,
      status: royaltySources.status,
      unitType: royaltySources.unitType,
      unitRatePence: royaltySources.unitRatePence,
    })
    .from(royaltySources)
    .where(eq(royaltySources.id, sourceId))
    .get();

  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  if (source.status === "revoked") return NextResponse.json({ error: "Source is revoked" }, { status: 409 });

  const access = await canManageLicenceRoyalties(session, source.licenceId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const talentId = access.talentId!;
  const settings = await db
    .select({
      talentSharePct: talentSettings.talentSharePct,
      agencySharePct: talentSettings.agencySharePct,
      platformSharePct: talentSettings.platformSharePct,
    })
    .from(talentSettings)
    .where(eq(talentSettings.talentId, talentId))
    .get();
  const pcts: SplitPcts = settings ?? DEFAULT_SPLIT;

  // Plausible unit volumes per unit type for a believable demo.
  const unitRanges: Record<string, [number, number]> = {
    per_generation: [1, 4],
    per_1k_inferences: [1, 12],
    per_frame: [24, 480],
    per_second: [2, 90],
  };
  const [lo, hi] = unitRanges[source.unitType] ?? [1, 4];
  const rand = (min: number, max: number) =>
    min + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff) * (max - min + 1));

  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const units = rand(lo, hi);
    const split = computeRoyalty(units, source.unitRatePence, pcts);
    rows.push({
      id: crypto.randomUUID(),
      sourceId: source.id,
      licenceId: source.licenceId,
      talentId,
      eventType: source.unitType,
      units,
      unitRatePence: source.unitRatePence,
      grossPence: split.grossPence,
      talentPence: split.talentPence,
      agencyPence: split.agencyPence,
      platformPence: split.platformPence,
      externalRef: `demo_${now}_${i}_${crypto.randomUUID().slice(0, 8)}`,
      detailJson: JSON.stringify({ demo: true, modelId: "demo-metahuman" }),
      occurredAt: now,
      recordedAt: now,
    });
  }

  await db.insert(usageEvents).values(rows);
  void db.update(royaltySources).set({ lastUsedAt: now }).where(eq(royaltySources.id, source.id)).run();

  const totalTalentPence = rows.reduce((a, r) => a + r.talentPence, 0);
  return NextResponse.json({ ok: true, fired: rows.length, talentPence: totalTalentPence }, { status: 201 });
}
