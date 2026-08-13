import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  likenessHits,
  users,
  talentProfiles,
  takedownSubmissions,
  aiSettings,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { buildTakedownLetter } from "@/lib/monitor/takedown-email";
import { sendEmail } from "@/lib/email/send";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/admin/monitor/takedowns/[hitId]/submit — send the report letter to
 * the platform's takedown email and record the submission.
 *
 * Refuses to send when the talent has no signed enforcement authorization on
 * file: Meta rejects reports from non-authorised third parties, and a rejected
 * report costs us sender reputation. Refuses when the platform has no
 * configured recipient in ai_settings — a takedown to `undefined@example.com`
 * would silently disappear.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hitId: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (!(session.role === "admin" || isAdmin(session.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { hitId } = await params;
  const db = getDb();

  const row = await db
    .select({
      hit: likenessHits,
      talentEmail: users.email,
      talentFullName: talentProfiles.fullName,
      knownFor: talentProfiles.knownFor,
      authOnFile: talentProfiles.enforcementAuthorizationOnFile,
    })
    .from(likenessHits)
    .innerJoin(users, eq(users.id, likenessHits.talentId))
    .leftJoin(talentProfiles, eq(talentProfiles.userId, users.id))
    .where(eq(likenessHits.id, hitId))
    .get();

  if (!row) {
    return NextResponse.json({ error: "Hit not found" }, { status: 404 });
  }

  if (row.hit.status !== "takedown_requested") {
    return NextResponse.json(
      { error: `Hit is in status "${row.hit.status}", not takedown_requested` },
      { status: 409 }
    );
  }

  if (!row.authOnFile) {
    return NextResponse.json(
      {
        error:
          "No enforcement authorization on file for this talent. Flip the flag on talent_profiles once a signed agent-of-record document is stored.",
      },
      { status: 412 }
    );
  }

  const recipientKey =
    row.hit.platform === "instagram"
      ? "takedown_email_instagram"
      : row.hit.platform === "facebook"
        ? "takedown_email_facebook"
        : null;

  if (!recipientKey) {
    return NextResponse.json(
      { error: `Automated takedown for platform "${row.hit.platform}" is not yet supported (v1 is Meta-only).` },
      { status: 400 }
    );
  }

  const recipientRow = await db
    .select({ value: aiSettings.value })
    .from(aiSettings)
    .where(eq(aiSettings.key, recipientKey))
    .get();
  const recipient = recipientRow?.value?.trim();
  if (!recipient) {
    return NextResponse.json(
      { error: `No recipient configured in ai_settings for key "${recipientKey}".` },
      { status: 500 }
    );
  }

  const reference = `IV-${hitId.slice(0, 8).toUpperCase()}`;
  const knownFor = parseKnownFor(row.knownFor);
  const matchSignals = parseMatchSignals(row.hit.matchSignalsJson);

  const { subject, html } = buildTakedownLetter({
    talent: {
      fullName: row.talentFullName ?? row.talentEmail,
      knownFor,
    },
    hit: {
      platform: row.hit.platform,
      contentUrl: row.hit.contentUrl,
      authorHandle: row.hit.authorHandle,
      caption: row.hit.caption,
      riskLevel: row.hit.riskLevel,
      aiGeneratedLikelihood: row.hit.aiGeneratedLikelihood,
      aiRationale: row.hit.aiRationale,
      matchSignals,
      detectedAt: row.hit.detectedAt,
    },
    reporter: {
      fullName: session.email.split("@")[0],
      email: session.email,
    },
    reference,
  });

  await sendEmail({
    to: recipient,
    subject,
    html,
    replyTo: session.email,
  });

  const now = Math.floor(Date.now() / 1000);
  const submissionId = crypto.randomUUID();
  await db.insert(takedownSubmissions).values({
    id: submissionId,
    hitId,
    talentId: row.hit.talentId,
    platform: row.hit.platform,
    method: "email",
    recipient,
    subject,
    bodyHtml: html,
    sentBy: session.sub,
    sentAt: now,
    platformStatus: "submitted",
  });

  return NextResponse.json({
    ok: true,
    submissionId,
    recipient,
    reference,
  });
}

function parseKnownFor(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "object" && item && "title" in item ? String((item as { title: unknown }).title) : null))
      .filter((s): s is string => !!s);
  } catch {
    return [];
  }
}

function parseMatchSignals(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
