export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { callAiService } from "@/lib/ai/service";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/ai/fee-guidance?licenceType=...&territory=...&exclusivity=...&proposedFee=...
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  // Check if AI is disabled for this user
  const db = getDb();
  const user = await db
    .select({ aiDisabled: users.aiDisabled })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  if (user?.aiDisabled) {
    return NextResponse.json({ guidance: null, stats: null });
  }

  return callAiService(req, session, "/fee-guidance");
}
