export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, users } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { requireBridgeToken, isBridgeTokenError } from "@/lib/auth/requireBridgeToken";

const TOOLS_BY_LICENCE_TYPE: Record<string, string[]> = {
  film_double:          ["nuke", "houdini", "maya"],
  game_character:       ["houdini", "unreal", "blender"],
  commercial:           ["nuke", "houdini", "maya", "blender"],
  ai_avatar:            ["nuke"],
  training_data:        [],
  monitoring_reference: ["nuke"],
};

/**
 * GET /api/bridge/licences
 *
 * PAT-authenticated. Returns all APPROVED, non-expired licences for the
 * calling licensee, with package name and talent name resolved.
 * Used by the Bridge app to populate the licence picker without the user
 * needing to copy/paste UUIDs.
 */
export async function GET(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const talentUsers = db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(users)
    .as("talent_users");

  const rows = await db
    .select({
      licenceId:       licences.id,
      packageId:       licences.packageId,
      packageName:     scanPackages.name,
      talentName:      talentUsers.fullName,
      licenceType:     licences.licenceType,
      projectName:     licences.projectName,
      productionCompany: licences.productionCompany,
      validTo:         licences.validTo,
      deliveryMode:    licences.deliveryMode,
    })
    .from(licences)
    .innerJoin(scanPackages, eq(scanPackages.id, licences.packageId))
    .innerJoin(talentUsers, eq(talentUsers.id, licences.talentId))
    .where(
      and(
        eq(licences.licenseeId, auth.userId),
        eq(licences.status, "APPROVED"),
        gt(licences.validTo, now)
      )
    )
    .orderBy(licences.validTo)
    .all();

  const result = rows.map((r) => ({
    licenceId:        r.licenceId,
    packageId:        r.packageId,
    packageName:      r.packageName,
    talentName:       r.talentName ?? "Unknown talent",
    licenceType:      r.licenceType ?? "unknown",
    projectName:      r.projectName,
    productionCompany: r.productionCompany,
    allowedTools:     TOOLS_BY_LICENCE_TYPE[r.licenceType ?? ""] ?? [],
    validTo:          r.validTo,
    deliveryMode:     r.deliveryMode,
  }));

  return NextResponse.json({ licences: result });
}
