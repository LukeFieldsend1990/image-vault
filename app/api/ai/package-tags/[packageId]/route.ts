export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { packageTags, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { callAiService } from "@/lib/ai/service";
import { triggerReindex } from "@/lib/search/reindex";
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

// POST /api/ai/package-tags/:packageId — add a tag (user or AI trigger)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { packageId } = await params;
  const db = getDb();

  let body: { tag?: string; category?: string; aiTrigger?: boolean };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // AI trigger mode — forward to ai-worker
  if (body.aiTrigger) {
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

  // Manual tag creation
  if (!body.tag?.trim() || !body.category?.trim()) {
    return NextResponse.json({ error: "tag and category are required" }, { status: 400 });
  }

  const tag = body.tag.trim().toLowerCase().replace(/\s+/g, "-");
  const category = body.category.trim().toLowerCase().replace(/\s+/g, "_");

  // Check for duplicate
  const allTags = await db
    .select({ tag: packageTags.tag, category: packageTags.category })
    .from(packageTags)
    .where(eq(packageTags.packageId, packageId))
    .all();

  if (allTags.some((t: { tag: string; category: string }) => t.tag === tag && t.category === category)) {
    return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
  }

  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  await db.insert(packageTags).values({
    id,
    packageId,
    tag,
    category,
    status: "accepted",
    suggestedBy: "user",
    reviewedBy: session.sub,
    reviewedAt: now,
    createdAt: now,
  });

  triggerReindex(packageId);

  return NextResponse.json({ id, tag, category }, { status: 201 });
}
