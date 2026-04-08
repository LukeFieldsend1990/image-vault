export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { receivedEmails, aiTriageResults } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, desc } from "drizzle-orm";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { resolveSkills } from "@/lib/skills/resolver";
import { getSkill } from "@/lib/skills/registry";
import type { SkillContext } from "@/lib/skills/types";

// Ensure skills are registered
import "@/lib/skills/definitions";

// GET /api/inbound/emails/:id/skills — suggested skills based on triage
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  // Verify email ownership
  const email = await db
    .select({ id: receivedEmails.id, fromEmail: receivedEmails.fromEmail })
    .from(receivedEmails)
    .where(and(eq(receivedEmails.id, id), eq(receivedEmails.ownerUserId, session.sub)))
    .get();

  if (!email) {
    return NextResponse.json({ suggestions: [] });
  }

  // Get latest triage result
  const triage = await db
    .select({
      category: aiTriageResults.category,
      confidence: aiTriageResults.confidence,
      structuredDataJson: aiTriageResults.structuredDataJson,
    })
    .from(aiTriageResults)
    .where(eq(aiTriageResults.emailId, id))
    .orderBy(desc(aiTriageResults.createdAt))
    .get();

  if (!triage?.category) {
    return NextResponse.json({ suggestions: [] });
  }

  let structuredData: Record<string, unknown> = {};
  if (triage.structuredDataJson) {
    try {
      structuredData = JSON.parse(triage.structuredDataJson);
    } catch {
      // ignore parse errors
    }
  }

  const suggestions = resolveSkills(
    triage.category,
    structuredData,
    triage.confidence ?? 0.5,
    email.fromEmail
  );

  return NextResponse.json({ suggestions });
}

// POST /api/inbound/emails/:id/skills — execute a skill
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;

  let body: { skillId?: string; params?: Record<string, unknown> };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { skillId, params: skillParams } = body;

  if (!skillId) {
    return NextResponse.json({ error: "skillId is required" }, { status: 400 });
  }

  const skill = getSkill(skillId);
  if (!skill) {
    return NextResponse.json({ error: "Unknown skill" }, { status: 404 });
  }

  const db = getDb();

  // Verify email ownership
  const email = await db
    .select({ id: receivedEmails.id })
    .from(receivedEmails)
    .where(and(eq(receivedEmails.id, id), eq(receivedEmails.ownerUserId, session.sub)))
    .get();

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // Validate required params
  for (const param of skill.parameters) {
    if (param.required && !skillParams?.[param.name]) {
      return NextResponse.json(
        { error: `Parameter "${param.name}" is required` },
        { status: 400 }
      );
    }
  }

  // Build context
  let env: Record<string, unknown>;
  try {
    const rc = getRequestContext();
    env = rc.env as unknown as Record<string, unknown>;
  } catch {
    env = process.env as unknown as Record<string, unknown>;
  }

  const ctx: SkillContext = {
    session,
    db,
    env,
    emailId: id,
  };

  const result = await skill.execute(ctx, skillParams ?? {});

  return NextResponse.json(result, {
    status: result.success ? 200 : 422,
  });
}
