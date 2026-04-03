export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { packageTags } from "@/lib/db/schema";
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
  return callAiService(req, session, `/package-tags/${packageId}`, {
    method: "POST",
  });
}
