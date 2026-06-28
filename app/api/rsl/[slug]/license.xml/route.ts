import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileBySlug, olpServerUrl, consentProfileUrl } from "@/lib/rsl/profile";
import { derivePosture } from "@/lib/rsl/posture";
import { isPublic } from "@/lib/rsl/visibility";
import { renderTalentRsl } from "@/lib/rsl/xml";

/**
 * Public, unauthenticated RSL license document for a talent's likeness.
 *
 * Served only when the two-key gate + vault state allow it (isPublic). On any
 * failure we return 404 — never 403 — so we don't confirm the slug exists.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const db = getDb();
  const row = await getProfileBySlug(db, slug);

  if (
    !row ||
    !isPublic({
      publishOptIn: row.profile.publishOptIn,
      adminApproved: row.profile.adminApproved,
      publicSlug: row.profile.publicSlug,
      vaultLocked: row.vaultLocked,
    })
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  const posture = await derivePosture(db, row.profile.talentId);
  const xml = renderTalentRsl({
    contentUrl: consentProfileUrl(slug),
    server: olpServerUrl(),
    posture,
  });

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rsl+xml; charset=utf-8",
      // Modest caching; posture can change when the talent edits instructions.
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
