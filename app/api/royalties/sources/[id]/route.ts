import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { royaltySources } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { canManageLicenceRoyalties } from "@/lib/royalties/access";

// DELETE /api/royalties/sources/:id — revoke a royalty source key.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const source = await db
    .select({ licenceId: royaltySources.licenceId, status: royaltySources.status })
    .from(royaltySources)
    .where(eq(royaltySources.id, id))
    .get();

  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await canManageLicenceRoyalties(session, source.licenceId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (source.status !== "revoked") {
    await db
      .update(royaltySources)
      .set({ status: "revoked", revokedAt: Math.floor(Date.now() / 1000) })
      .where(eq(royaltySources.id, id))
      .run();
  }

  return NextResponse.json({ ok: true });
}
