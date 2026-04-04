export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { packageTags, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { callAiService } from "@/lib/ai/service";
import { eq } from "drizzle-orm";

// GET /api/ai/package-tags/:packageId — return all tags for the package
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  const tags = await db
    .select()
    .from(packageTags)
    .where(eq(packageTags.packageId, packageId))
    .all();

  return NextResponse.json({ tags });
}

// POST /api/ai/package-tags/:packageId — trigger AI tag suggestion
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;

  // Check if AI is disabled for this user
  const db = getDb();
  const user = await db
    .select({ aiDisabled: users.aiDisabled })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  if (user?.aiDisabled) {
    return NextResponse.json({ error: "AI features are disabled for this account" }, { status: 403 });
  }

  return callAiService(req, session, `/package-tags/${packageId}`, {
    method: "POST",
  });
}
