import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { royaltySources, licences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface RoyaltySourcePayload {
  sourceId: string;
  licenceId: string;
  talentId: string;
  displayName: string;
  unitType: "per_generation" | "per_1k_inferences" | "per_frame" | "per_second";
  unitRatePence: number;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a raw royalty source key — 32 bytes → 64 hex, prefixed `rsk_`. */
export function generateRoyaltyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "rsk_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates `Authorization: Bearer rsk_<token>` against royalty_sources.
 * Resolves the source's licence + talent so callers never specify who gets paid.
 * Returns the source payload or a 401 NextResponse.
 */
export async function requireRoyaltySource(
  req: NextRequest
): Promise<RoyaltySourcePayload | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing royalty source key" }, { status: 401 });
  }

  const rawKey = auth.slice(7).trim();
  if (!rawKey) {
    return NextResponse.json({ error: "Missing royalty source key" }, { status: 401 });
  }

  const apiKeyHash = await sha256Hex(rawKey);
  const db = getDb();

  const row = await db
    .select({
      id: royaltySources.id,
      licenceId: royaltySources.licenceId,
      status: royaltySources.status,
      displayName: royaltySources.displayName,
      unitType: royaltySources.unitType,
      unitRatePence: royaltySources.unitRatePence,
      talentId: licences.talentId,
    })
    .from(royaltySources)
    .innerJoin(licences, eq(licences.id, royaltySources.licenceId))
    .where(eq(royaltySources.apiKeyHash, apiKeyHash))
    .get();

  if (!row || row.status === "revoked") {
    return NextResponse.json({ error: "Invalid or revoked royalty source key" }, { status: 401 });
  }

  // Update lastUsedAt (fire-and-forget, don't await)
  const now = Math.floor(Date.now() / 1000);
  void db
    .update(royaltySources)
    .set({ lastUsedAt: now })
    .where(eq(royaltySources.id, row.id))
    .run();

  return {
    sourceId: row.id,
    licenceId: row.licenceId,
    talentId: row.talentId,
    displayName: row.displayName,
    unitType: row.unitType,
    unitRatePence: row.unitRatePence,
  };
}

export function isRoyaltySourceError(
  result: RoyaltySourcePayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
