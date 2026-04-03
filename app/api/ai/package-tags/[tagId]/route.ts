export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { packageTags } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

// PATCH /api/ai/package-tags/:tagId — accept or dismiss a tag
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { tagId } = await params;

  let body: { status?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch { /* ok */ }

  if (body.status !== "accepted" && body.status !== "dismissed") {
    return NextResponse.json(
      { error: "status must be 'accepted' or 'dismissed'" },
      { status: 400 }
    );
  }

  const db = getDb();

  const existing = await db
    .select({ id: packageTags.id })
    .from(packageTags)
    .where(eq(packageTags.id, tagId))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(packageTags)
    .set({
      status: body.status,
      reviewedBy: session.sub,
      reviewedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(packageTags.id, tagId));

  return NextResponse.json({ ok: true });
}
