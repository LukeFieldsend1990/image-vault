export const runtime = "edge";

import { NextRequest } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { callAiService } from "@/lib/ai/service";

// GET /api/ai/fee-guidance?licenceType=...&territory=...&exclusivity=...&proposedFee=...
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  return callAiService(req, session, "/fee-guidance");
}
