import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { likenessHits } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { createNotification } from "@/lib/notifications/create";
import { platformName } from "@/lib/monitor/platforms";
import { and, eq } from "drizzle-orm";

const ALLOWED_TRANSITIONS = new Set(["confirmed", "dismissed", "takedown_requested", "resolved"]);
const DISMISSAL_REASONS = new Set(["not_me", "not_misuse", "not_ai", "other"]);

// PATCH /api/monitor/hits/:id — triage a hit (confirm / dismiss / request takedown / resolve).
// When status=dismissed, the caller must also supply a reason (and, for
// reason=other, a notes field). Bare "dismissed" without a reason is rejected
// because that's what we're trying to move away from.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Only talent accounts can triage likeness hits" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    dismissalReason?: string;
    dismissalNotes?: string;
  };
  if (!body.status || !ALLOWED_TRANSITIONS.has(body.status)) {
    return NextResponse.json(
      { error: "status must be one of confirmed | dismissed | takedown_requested | resolved" },
      { status: 400 }
    );
  }

  let dismissalReason: string | null = null;
  let dismissalNotes: string | null = null;
  if (body.status === "dismissed") {
    if (!body.dismissalReason || !DISMISSAL_REASONS.has(body.dismissalReason)) {
      return NextResponse.json(
        { error: "dismissalReason must be one of not_me | not_misuse | not_ai | other" },
        { status: 400 }
      );
    }
    dismissalReason = body.dismissalReason;
    if (body.dismissalReason === "other") {
      const notes = body.dismissalNotes?.trim();
      if (!notes) {
        return NextResponse.json(
          { error: "dismissalNotes required when dismissalReason is 'other'" },
          { status: 400 }
        );
      }
      dismissalNotes = notes.slice(0, 500);
    }
  }

  const db = getDb();
  const hit = await db
    .select()
    .from(likenessHits)
    .where(and(eq(likenessHits.id, id), eq(likenessHits.talentId, session.sub)))
    .get();
  if (!hit) {
    return NextResponse.json({ error: "Hit not found" }, { status: 404 });
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(likenessHits)
    .set({
      status: body.status as "confirmed" | "dismissed" | "takedown_requested" | "resolved",
      statusUpdatedBy: session.sub,
      statusUpdatedAt: now,
      dismissalReason: dismissalReason as "not_me" | "not_misuse" | "not_ai" | "other" | null,
      dismissalNotes,
    })
    .where(eq(likenessHits.id, id));

  if (body.status === "takedown_requested") {
    void createNotification(db, {
      userId: session.sub,
      type: "likeness_takedown",
      title: "Takedown request logged",
      body: `${platformName(hit.platform)} · ${hit.authorHandle ?? "unknown account"} — our enforcement queue will file the platform notice.`,
      href: "/vault/monitor",
    });
  }

  return NextResponse.json({ ok: true, status: body.status });
}
