export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { mcpTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { logMcpCall } from "@/lib/mcp/audit";

// DELETE /api/mcp/tokens/:id — revoke an MCP token
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();

  const row = await db
    .select({ id: mcpTokens.id, displayName: mcpTokens.displayName, revokedAt: mcpTokens.revokedAt })
    .from(mcpTokens)
    .where(eq(mcpTokens.id, id))
    .get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.revokedAt !== null) {
    return NextResponse.json({ error: "Already revoked" }, { status: 409 });
  }

  await db
    .update(mcpTokens)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(mcpTokens.id, id));

  void logMcpCall(db, {
    tokenId: id,
    userId: session.sub,
    tool: "token.revoked",
    success: true,
    message: `MCP token "${row.displayName}" revoked by ${session.email}.`,
  });

  return NextResponse.json({ ok: true });
}
