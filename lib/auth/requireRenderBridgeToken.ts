import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { renderBridgeAgents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface RenderBridgeTokenPayload {
  agentId: string;
  organisationId: string;
  productionId: string;
  status: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates `Authorization: Bearer svc_<hex>` against render_bridge_agents.service_token_hash.
 * Returns the agent payload or a 401 NextResponse.
 */
export async function requireRenderBridgeToken(
  req: NextRequest
): Promise<RenderBridgeTokenPayload | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing service token" }, { status: 401 });
  }

  const rawToken = auth.slice(7).trim();
  if (!rawToken) {
    return NextResponse.json({ error: "Missing service token" }, { status: 401 });
  }

  const tokenHash = await sha256Hex(rawToken);
  const db = getDb();

  const agent = await db
    .select({
      id: renderBridgeAgents.id,
      organisationId: renderBridgeAgents.organisationId,
      productionId: renderBridgeAgents.productionId,
      status: renderBridgeAgents.status,
      revokedAt: renderBridgeAgents.revokedAt,
    })
    .from(renderBridgeAgents)
    .where(eq(renderBridgeAgents.serviceTokenHash, tokenHash))
    .get();

  if (!agent) {
    return NextResponse.json({ error: "Invalid service token" }, { status: 401 });
  }
  if (agent.revokedAt !== null || agent.status === "revoked") {
    return NextResponse.json({ error: "Agent revoked" }, { status: 401 });
  }

  return {
    agentId: agent.id,
    organisationId: agent.organisationId,
    productionId: agent.productionId,
    status: agent.status,
  };
}

export function isRenderBridgeTokenError(
  result: RenderBridgeTokenPayload | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
