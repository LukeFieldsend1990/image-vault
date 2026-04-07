export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  receivedEmails,
  aiTriageResults,
  scanPackages,
  licences,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and, like, or } from "drizzle-orm";

// GET /api/inbound/emails/:id/linked-assets — find packages/licences matching triage data
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  // Verify email ownership
  const email = await db
    .select({ id: receivedEmails.id })
    .from(receivedEmails)
    .where(and(eq(receivedEmails.id, id), eq(receivedEmails.ownerUserId, session.sub)))
    .get();

  if (!email) {
    return NextResponse.json({ assets: [] });
  }

  // Get latest triage result
  const triageRows = await db
    .select({ structuredDataJson: aiTriageResults.structuredDataJson })
    .from(aiTriageResults)
    .where(eq(aiTriageResults.emailId, id))
    .all();

  if (triageRows.length === 0) {
    return NextResponse.json({ assets: [] });
  }

  const latest = triageRows[triageRows.length - 1];
  if (!latest.structuredDataJson) {
    return NextResponse.json({ assets: [] });
  }

  let structured: Record<string, unknown>;
  try {
    structured = JSON.parse(latest.structuredDataJson);
  } catch {
    return NextResponse.json({ assets: [] });
  }

  // Collect search terms from structured data (sanitise LIKE wildcards)
  function sanitiseLike(s: string): string {
    return s.replace(/[%_]/g, "");
  }
  const searchTerms: string[] = [];
  for (const key of ["talent_name", "production_name", "company_name"]) {
    const val = structured[key];
    if (typeof val === "string" && sanitiseLike(val.trim())) {
      searchTerms.push(sanitiseLike(val.trim()));
    }
  }
  const peopleMentioned = structured["people_mentioned"];
  if (Array.isArray(peopleMentioned)) {
    for (const p of peopleMentioned) {
      if (typeof p === "string" && sanitiseLike(p.trim())) searchTerms.push(sanitiseLike(p.trim()));
    }
  }

  if (searchTerms.length === 0) {
    return NextResponse.json({ assets: [] });
  }

  // Cap search terms to prevent query bloat from crafted emails
  const terms = searchTerms.slice(0, 10);

  const assets: Array<{ type: string; name: string; href: string }> = [];

  // Search packages by name (owned by this user as talent)
  const packageConditions = terms.map((term) => like(scanPackages.name, `%${term}%`));
  const matchingPackages = await db
    .select({ id: scanPackages.id, name: scanPackages.name })
    .from(scanPackages)
    .where(and(eq(scanPackages.talentId, session.sub), or(...packageConditions)))
    .all();

  for (const pkg of matchingPackages) {
    assets.push({
      type: "package",
      name: pkg.name,
      href: `/vault/packages/${pkg.id}/chain-of-custody`,
    });
  }

  // Search licences by project name or production company (where user is talent or licensee)
  const licenceConditions = terms.flatMap((term) => [
    like(licences.projectName, `%${term}%`),
    like(licences.productionCompany, `%${term}%`),
  ]);
  const matchingLicences = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
    })
    .from(licences)
    .where(
      and(
        or(eq(licences.talentId, session.sub), eq(licences.licenseeId, session.sub)),
        or(...licenceConditions)
      )
    )
    .all();

  for (const lic of matchingLicences) {
    assets.push({
      type: "licence",
      name: `${lic.projectName} (${lic.productionCompany})`,
      href: `/vault/licences`,
    });
  }

  return NextResponse.json({ assets });
}
