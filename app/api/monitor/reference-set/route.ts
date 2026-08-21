import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { getActiveReferences, syncReferenceSet } from "@/lib/monitor/reference-set";
import { buildCoveragePayload } from "@/lib/monitor/coverage";
import { maybeEnqueueDerivedStills } from "@/lib/monitor/derived-stills";
import { scanPackages } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

// GET  /api/monitor/reference-set — the talent's detection coverage: which
//      vault scans anchor identity matching, and what to add to strengthen it.
// POST /api/monitor/reference-set — re-sync the reference set against the
//      vault now (also happens lazily at the top of every sweep).

export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Deep Scan is only available to talent accounts" }, { status: 403 });
  }

  const db = getDb();
  const refs = await getActiveReferences(db, session.sub);
  return NextResponse.json(await buildCoveragePayload(db, session.sub, refs));
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;
  if (session.role !== "talent") {
    return NextResponse.json({ error: "Deep Scan is only available to talent accounts" }, { status: 403 });
  }

  const db = getDb();
  const refs = await syncReferenceSet(db, session.sub);

  // Nothing to anchor on? Give mesh/video-only packages a self-serve path
  // to derived reference stills — the sync will pick the renders up once
  // the pipeline job lands them.
  if (refs.length === 0) {
    try {
      const packages = await db
        .select({ id: scanPackages.id })
        .from(scanPackages)
        .where(
          and(
            eq(scanPackages.talentId, session.sub),
            eq(scanPackages.status, "ready"),
            isNull(scanPackages.deletedAt)
          )
        )
        .all();
      for (const pkg of packages) {
        await maybeEnqueueDerivedStills(db, pkg.id);
      }
    } catch {
      // Enhancement only — the payload below is still the answer.
    }
  }

  return NextResponse.json(await buildCoveragePayload(db, session.sub, refs));
}
