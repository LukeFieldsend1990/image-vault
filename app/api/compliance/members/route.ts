import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canViewPlatformOversight } from "@/lib/compliance/grants";
import { addMembers, buildMemberRoster, clearRoster, parseMemberNames } from "@/lib/compliance/members";

// GET    /api/compliance/members — roster with live on-platform matching + coverage.
// POST   /api/compliance/members — append names ({ csv } blob or { names } array).
// DELETE /api/compliance/members — clear the whole roster.
// Maintainers: admins + compliance watchers with a platform-wide grant.

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roster = await buildMemberRoster(db);
  return NextResponse.json(roster);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { csv?: unknown; names?: unknown };
  try {
    body = (await req.json()) as { csv?: unknown; names?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let names: string[] = [];
  if (typeof body.csv === "string") {
    names = parseMemberNames(body.csv);
  } else if (Array.isArray(body.names)) {
    names = parseMemberNames(body.names.filter((n): n is string => typeof n === "string").join("\n"));
  }
  if (names.length === 0) return NextResponse.json({ error: "No member names found" }, { status: 400 });

  const result = await addMembers(db, names, session.sub);
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  if (!(await canViewPlatformOversight(db, session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cleared = await clearRoster(db);
  return NextResponse.json({ ok: true, cleared });
}
