import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { isAiEnabled, isFeatureEnabled } from "@/lib/ai/cost-tracker";
import { callAi } from "@/lib/ai/providers";
import { suggestPackageTags } from "@/lib/ai/package-tags";
import { checkBridgeAnomalies } from "@/lib/ai/security-alerts";
import { runSuggestionBatch } from "@/lib/ai/suggestion-engine";
import { FEE_GUIDANCE_PROMPT } from "@/lib/ai/constants";

const { licences } = schema;

interface Env {
  DB: D1Database;
  AI?: Ai;
  ANTHROPIC_API_KEY?: string;
}

interface Actor {
  userId: string;
  role: string;
  email: string;
}

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

function getActor(request: Request): Actor | null {
  const userId = request.headers.get("x-ai-user-id");
  const role = request.headers.get("x-ai-user-role");
  const email = request.headers.get("x-ai-user-email");

  if (!userId || !role || !email) return null;
  return { userId, role, email };
}

function requireActor(request: Request): Actor | Response {
  const actor = getActor(request);
  if (!actor) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  return actor;
}

function isAdmin(actor: Actor) {
  return actor.role === "admin" || ADMIN_EMAILS.includes(actor.email);
}

async function handleFeeGuidance(request: Request, env: Env) {
  const actor = requireActor(request);
  if (actor instanceof Response) return actor;

  const db = getDb(env);
  const [featureOn, aiOn] = await Promise.all([
    isFeatureEnabled(db, "fee_guidance"),
    isAiEnabled(db),
  ]);

  if (!featureOn || !aiOn) {
    return Response.json({ guidance: null, reason: "feature_disabled" });
  }

  const url = new URL(request.url);
  const licenceType = url.searchParams.get("licenceType");
  const territory = url.searchParams.get("territory");
  const exclusivity = url.searchParams.get("exclusivity");
  const proposedFeeRaw = url.searchParams.get("proposedFee");

  if (!licenceType) {
    return Response.json({ error: "licenceType is required" }, { status: 400 });
  }

  const proposedFee = proposedFeeRaw ? parseInt(proposedFeeRaw, 10) : null;
  const conditions = [
    eq(licences.status, "APPROVED"),
    eq(
      licences.licenceType,
      licenceType as (typeof licences.licenceType.enumValues)[number]
    ),
    sql`${licences.agreedFee} IS NOT NULL`,
  ];

  if (territory) {
    conditions.push(eq(licences.territory, territory));
  }
  if (exclusivity) {
    conditions.push(
      eq(
        licences.exclusivity,
        exclusivity as (typeof licences.exclusivity.enumValues)[number]
      )
    );
  }

  const comparables = await db
    .select({ agreedFee: licences.agreedFee })
    .from(licences)
    .where(and(...conditions))
    .all();

  if (comparables.length < 3) {
    return Response.json({ guidance: null, reason: "insufficient_data" });
  }

  const fees = comparables.map((c) => c.agreedFee!).sort((a, b) => a - b);
  const count = fees.length;
  const median =
    count % 2 === 1
      ? fees[Math.floor(count / 2)]
      : Math.round((fees[count / 2 - 1] + fees[count / 2]) / 2);
  const p25 = fees[Math.floor(count * 0.25)];
  const p75 = fees[Math.floor(count * 0.75)];

  const result = await callAi(env, db, {
    feature: "fee_guidance",
    requiresReasoning: true,
    system: FEE_GUIDANCE_PROMPT,
    userMessage: JSON.stringify({
      licenceType,
      territory,
      exclusivity,
      proposedFee,
      comparables: fees,
    }),
  });

  let guidance: string | null = null;
  if (result) {
    try {
      const parsed = JSON.parse(result.text);
      guidance = parsed.guidance ?? null;
    } catch {
      guidance = result.text.trim() || null;
    }
  }

  return Response.json({
    guidance,
    stats: { median, p25, p75, count },
  });
}

async function handlePackageTagSuggestion(request: Request, env: Env, packageId: string) {
  const actor = requireActor(request);
  if (actor instanceof Response) return actor;

  const db = getDb(env);
  await suggestPackageTags(env, db, packageId);
  return Response.json({ ok: true });
}

async function handleRunBatch(request: Request, env: Env, ctx: ExecutionContext) {
  const actor = requireActor(request);
  if (actor instanceof Response) return actor;
  if (!isAdmin(actor)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb(env);
  ctx.waitUntil(runSuggestionBatch(env, db, { manual: true }));
  return Response.json({
    status: "started",
    message: "Batch running in background. Check suggestions or costs panel for results.",
  });
}

async function handleBridgeSecurityEvent(request: Request, env: Env) {
  if (request.headers.get("x-ai-source") !== "bridge-events") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    grantId?: string | null;
    packageId?: string;
    deviceId?: string;
    eventType?: string;
    severity?: string;
    userId?: string | null;
  };

  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.packageId || !body.deviceId || !body.eventType || !body.severity) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const db = getDb(env);
  await checkBridgeAnomalies(db, env, {
    grantId: body.grantId ?? null,
    packageId: body.packageId,
    deviceId: body.deviceId,
    eventType: body.eventType,
    severity: body.severity,
    userId: body.userId ?? null,
  });

  return Response.json({ ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/fee-guidance") {
      return handleFeeGuidance(request, env);
    }

    if (request.method === "POST" && url.pathname.startsWith("/package-tags/")) {
      const packageId = url.pathname.slice("/package-tags/".length);
      if (!packageId) {
        return Response.json({ error: "packageId is required" }, { status: 400 });
      }
      return handlePackageTagSuggestion(request, env, packageId);
    }

    if (request.method === "POST" && url.pathname === "/batch/run") {
      return handleRunBatch(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/security/bridge-event") {
      return handleBridgeSecurityEvent(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
