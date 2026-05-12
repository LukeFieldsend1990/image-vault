export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents, organisations, productions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireBridgeToken, isBridgeTokenError } from "@/lib/auth/requireBridgeToken";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateServiceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `svc_${hex}`;
}

/**
 * POST /api/bridge/render-bridge
 *
 * Enrolment. Called once on Docker first-start. Auth via an existing bridge PAT
 * (issued to the org admin via /api/bridge/tokens).
 *
 * Body: { vendorId?, organisationId, projectId, displayName }
 * Returns 201: { agentId, serviceToken, tokenExpiresAt }
 */
export async function POST(req: NextRequest) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  let body: { vendorId?: string; organisationId?: string; projectId?: string; displayName?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { organisationId, projectId, displayName } = body;
  if (!organisationId || !projectId || !displayName) {
    return NextResponse.json(
      { error: "organisationId, projectId, and displayName are required" },
      { status: 400 }
    );
  }

  const db = getDb();

  const [org, production] = await Promise.all([
    db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, organisationId)).get(),
    db.select({ id: productions.id }).from(productions).where(eq(productions.id, projectId)).get(),
  ]);

  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  if (!production) return NextResponse.json({ error: "Production not found" }, { status: 404 });

  const agentId = crypto.randomUUID();
  const serviceToken = generateServiceToken();
  const serviceTokenHash = await sha256Hex(serviceToken);
  const now = Math.floor(Date.now() / 1000);
  const tokenExpiresAt = now + 365 * 86400;

  await db.insert(renderBridgeAgents).values({
    id: agentId,
    organisationId,
    productionId: projectId,
    displayName,
    serviceTokenHash,
    tokenExpiresAt,
    status: "active",
    publishedPackagesJson: "[]",
    createdAt: now,
  });

  return NextResponse.json(
    {
      agentId,
      serviceToken,
      tokenExpiresAt: new Date(tokenExpiresAt * 1000).toISOString(),
    },
    { status: 201 }
  );
}
