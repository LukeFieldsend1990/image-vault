import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { addMembers, buildMemberRoster, clearRoster, parseMemberNames, resolveRosterUnion } from "@/lib/compliance/members";

// GET    /api/compliance/members?unionId= — one union's roster with live on-platform
//        matching + coverage, plus the unions the caller may manage.
// POST   /api/compliance/members — append names ({ csv } blob or { names } array) to
//        a union's roster ({ unionId }).
// DELETE /api/compliance/members?unionId= — clear that union's roster.
// Access: admins (any union) + union watchers with a platform-wide grant (their union).

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const ctx = await resolveRosterUnion(db, session, new URL(req.url).searchParams.get("unionId"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const roster = await buildMemberRoster(db, ctx.unionId);
  return NextResponse.json({ ...roster, unions: ctx.available, unionId: ctx.unionId });
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { csv?: unknown; names?: unknown; unionId?: unknown };
  try {
    body = (await req.json()) as { csv?: unknown; names?: unknown; unionId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDb();
  const ctx = await resolveRosterUnion(db, session, typeof body.unionId === "string" ? body.unionId : null);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let names: string[] = [];
  if (typeof body.csv === "string") {
    names = parseMemberNames(body.csv);
  } else if (Array.isArray(body.names)) {
    names = parseMemberNames(body.names.filter((n): n is string => typeof n === "string").join("\n"));
  }
  if (names.length === 0) return NextResponse.json({ error: "No member names found" }, { status: 400 });

  const result = await addMembers(db, names, session.sub, ctx.unionId);
  return NextResponse.json({ ok: true, unionId: ctx.unionId, ...result }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const ctx = await resolveRosterUnion(db, session, new URL(req.url).searchParams.get("unionId"));
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const cleared = await clearRoster(db, ctx.unionId);
  return NextResponse.json({ ok: true, unionId: ctx.unionId, cleared });
}
