import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { getRslSettings, setRslSettings } from "@/lib/rsl/settings";

/** Admin kill switches for the OLP rail. */
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getRslSettings(getDb()));
}

// POST { olpEnabled?, autoAcceptEnabled? }
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { olpEnabled?: unknown; autoAcceptEnabled?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: { olpEnabled?: boolean; autoAcceptEnabled?: boolean } = {};
  if (typeof body.olpEnabled === "boolean") patch.olpEnabled = body.olpEnabled;
  if (typeof body.autoAcceptEnabled === "boolean") patch.autoAcceptEnabled = body.autoAcceptEnabled;
  const next = await setRslSettings(getDb(), session.sub, patch);
  return NextResponse.json({ ok: true, ...next });
}
