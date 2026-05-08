export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin, ADMIN_EMAILS } from "@/lib/auth/adminEmails";
import { sendEmail } from "@/lib/email/send";
import { clonePackagesEmail } from "@/lib/email/templates";
import { getRequestContext } from "@cloudflare/next-on-pages";
import type { CloneRunRecord } from "../shared";
import { todayKey } from "../shared";

// POST /api/admin/clone-packages/finalize
// Called by the client after all per-package clone calls succeed.
// Writes the daily rate-limit record to KV and emails all admins.
// Idempotent — if already finalized today, returns the existing record.
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!isAdmin(session.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kv = getRequestContext().env.SESSIONS_KV;

  // Already finalized today — return existing record (idempotent)
  const existing = await kv.get(todayKey());
  if (existing) {
    return NextResponse.json({ ok: true, record: JSON.parse(existing) as CloneRunRecord });
  }

  let body: {
    sourceEmail?: string;
    targetEmail?: string;
    packages?: number;
    files?: number;
    filesFailed?: number;
    tags?: number;
    skipped?: number;
    hasErrors?: boolean;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceEmail, targetEmail } = body;
  if (!sourceEmail || !targetEmail) {
    return NextResponse.json({ error: "sourceEmail and targetEmail required" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const summary = {
    packages: body.packages ?? 0,
    files: body.files ?? 0,
    filesFailed: body.filesFailed ?? 0,
    tags: body.tags ?? 0,
    skipped: body.skipped ?? 0,
  };

  const record: CloneRunRecord = {
    runAt: now,
    triggeredBy: session.email,
    sourceEmail,
    targetEmail,
    summary,
  };

  // Only write the daily block if everything succeeded — failures allow same-day retries.
  // Dedup on the per-package POST means already-cloned packages are safely skipped on retry.
  if (!body.hasErrors) {
    await kv.put(todayKey(), JSON.stringify(record), { expirationTtl: 172800 });
  }

  void (async () => {
    const { subject, html } = clonePackagesEmail({
      triggeredBy: session.email,
      sourceEmail,
      targetEmail,
      ranAt: now,
      packages: summary.packages,
      files: summary.files,
      filesFailed: summary.filesFailed,
      tags: summary.tags,
    });
    await sendEmail({ to: [...ADMIN_EMAILS], subject, html });
  })();

  return NextResponse.json({ ok: true, record });
}
