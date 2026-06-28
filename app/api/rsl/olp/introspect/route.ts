import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { introspect } from "@/lib/rsl/olp";

/**
 * OAuth 2.0-style token introspection (RFC 7662) for RSL license tokens. A
 * resource server (e.g. a downstream AI platform) posts a token to check whether
 * it is an active license and for which usage.
 */
export async function POST(req: NextRequest) {
  let token = "";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const body = (await req.json()) as { token?: unknown };
      if (typeof body.token === "string") token = body.token;
    } catch {
      /* ignore */
    }
  } else {
    try {
      const form = await req.formData();
      const v = form.get("token");
      if (typeof v === "string") token = v;
    } catch {
      /* ignore */
    }
  }

  if (!token) return NextResponse.json({ active: false }, { status: 200 });

  const db = getDb();
  const result = await introspect(db, token);
  return NextResponse.json(result, { status: 200 });
}
