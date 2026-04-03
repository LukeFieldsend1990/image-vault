export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { licences } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isFeatureEnabled, isAiEnabled } from "@/lib/ai/cost-tracker";
import { callAi } from "@/lib/ai/providers";
import { FEE_GUIDANCE_PROMPT } from "@/lib/ai/constants";
import { eq, and, sql } from "drizzle-orm";

// GET /api/ai/fee-guidance?licenceType=...&territory=...&exclusivity=...&proposedFee=...
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();

  // Check feature flags
  const [featureOn, aiOn] = await Promise.all([
    isFeatureEnabled(db, "fee_guidance"),
    isAiEnabled(db),
  ]);

  if (!featureOn || !aiOn) {
    return NextResponse.json({ guidance: null, reason: "feature_disabled" });
  }

  const url = new URL(req.url);
  const licenceType = url.searchParams.get("licenceType");
  const territory = url.searchParams.get("territory");
  const exclusivity = url.searchParams.get("exclusivity");
  const proposedFeeRaw = url.searchParams.get("proposedFee");

  if (!licenceType) {
    return NextResponse.json(
      { error: "licenceType is required" },
      { status: 400 }
    );
  }

  const proposedFee = proposedFeeRaw ? parseInt(proposedFeeRaw, 10) : null;

  // Build conditions for comparable licences
  const conditions = [
    eq(licences.status, "APPROVED"),
    eq(licences.licenceType, licenceType as typeof licences.licenceType.enumValues[number]),
    sql`${licences.agreedFee} IS NOT NULL`,
  ];
  if (territory) {
    conditions.push(eq(licences.territory, territory));
  }
  if (exclusivity) {
    conditions.push(eq(licences.exclusivity, exclusivity as typeof licences.exclusivity.enumValues[number]));
  }

  const comparables = await db
    .select({ agreedFee: licences.agreedFee })
    .from(licences)
    .where(and(...conditions))
    .all();

  if (comparables.length < 3) {
    return NextResponse.json({ guidance: null, reason: "insufficient_data" });
  }

  // Calculate stats
  const fees = comparables
    .map((c) => c.agreedFee!)
    .sort((a, b) => a - b);

  const count = fees.length;
  const median = count % 2 === 1
    ? fees[Math.floor(count / 2)]
    : Math.round((fees[count / 2 - 1] + fees[count / 2]) / 2);

  const p25Index = Math.floor(count * 0.25);
  const p75Index = Math.floor(count * 0.75);
  const p25 = fees[p25Index];
  const p75 = fees[p75Index];

  // Call AI
  const { env } = getRequestContext();
  const userMessage = JSON.stringify({
    licenceType,
    territory,
    exclusivity,
    proposedFee,
    comparables: fees,
  });

  const result = await callAi(env, db, {
    feature: "fee_guidance",
    requiresReasoning: true,
    system: FEE_GUIDANCE_PROMPT,
    userMessage,
  });

  let guidance: string | null = null;

  if (result) {
    try {
      const parsed = JSON.parse(result.text);
      guidance = parsed.guidance ?? null;
    } catch {
      // If the response isn't JSON, use raw text as guidance
      guidance = result.text.trim() || null;
    }
  }

  return NextResponse.json({
    guidance,
    stats: { median, p25, p75, count },
  });
}
