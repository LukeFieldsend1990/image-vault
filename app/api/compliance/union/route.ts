import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getUnionScopeUnionIds } from "@/lib/compliance/grants";
import { affiliatedProductions, affiliatedTalent } from "@/lib/compliance/affiliation";
import { UNION_PRESETS, getUnionPreset } from "@/lib/compliance/unions";

// GET /api/compliance/union          → every union the caller watches via a union-
//                                       scope grant, each with affiliated entities.
// GET /api/compliance/union?id=<u>    → one union's affiliated talent + productions.
//
// Read-only: lists the on-platform talent affiliated with the union (its member
// roster matched live) and the productions those talent are involved in. The
// individual talent/production scopes drill into evidence via /api/compliance/evidence,
// which authorises the same affiliation set.
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  const admin = isAdmin(session.email);
  if (!isComplianceRole(session.role) && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const requested = new URL(req.url).searchParams.get("id");

  // Admins may inspect any preset; watchers only the unions they hold a union-scope
  // grant for.
  const allowed = admin ? UNION_PRESETS.map((u) => u.id) : await getUnionScopeUnionIds(db, session.sub);

  let unionIds: string[];
  if (requested) {
    if (!allowed.includes(requested)) {
      return NextResponse.json({ error: "No union-scope grant for that union" }, { status: 403 });
    }
    unionIds = [requested];
  } else {
    unionIds = allowed;
  }

  const unions = await Promise.all(
    unionIds.map(async (id) => {
      const preset = getUnionPreset(id);
      const [talent, productions] = await Promise.all([
        affiliatedTalent(db, [id]),
        affiliatedProductions(db, [id]),
      ]);
      return {
        unionId: id,
        shortName: preset?.shortName ?? id,
        name: preset?.name ?? id,
        talent,
        productions,
      };
    }),
  );

  return NextResponse.json({ unions });
}
