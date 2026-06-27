import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { loadStandingInstructions, setStandingInstructions } from "@/lib/consent/standing-instructions";
import { listUseCategories } from "@/lib/consent/use-categories";

// Resolve which talent the caller may read/write standing instructions for.
async function resolveTalentId(session: { sub: string; email: string; role: string }, requested: string | null): Promise<string | null> {
  const target = requested && requested.trim() ? requested.trim() : session.sub;
  if (target === session.sub) return target;            // self
  if (isAdmin(session.email)) return target;            // admin
  if (session.role === "rep" && (await hasRepAccess(session.sub, target))) return target; // agent
  return null;
}

// GET /api/talent/standing-instructions?talentId=
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const target = await resolveTalentId(session, req.nextUrl.searchParams.get("talentId"));
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = getDb();
  const map = await loadStandingInstructions(db, target);
  return NextResponse.json({
    talentId: target,
    instructions: map,
    categories: listUseCategories(),
  });
}

// PUT /api/talent/standing-instructions
// Body: { talentId?: string, updates: Record<useCategoryId, 'always'|'case_by_case'|'never'> }
export async function PUT(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { talentId?: unknown; updates?: unknown } = {};
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const requested = typeof body.talentId === "string" ? body.talentId : null;
  const target = await resolveTalentId(session, requested);
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (typeof body.updates !== "object" || body.updates === null) {
    return NextResponse.json({ error: "updates object required" }, { status: 400 });
  }
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.updates as Record<string, unknown>)) {
    if (typeof v === "string") updates[k] = v;
  }

  const db = getDb();
  await setStandingInstructions(db, target, session.sub, updates);
  const map = await loadStandingInstructions(db, target);
  return NextResponse.json({ ok: true, talentId: target, instructions: map });
}
