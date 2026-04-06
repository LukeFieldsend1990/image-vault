export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { inboundAliases, users } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { generateAlias, fullAddress } from "@/lib/inbound/alias";

async function checkInboundEnabled(db: ReturnType<typeof getDb>, userId: string): Promise<boolean> {
  const row = await db
    .select({ inboundEnabled: users.inboundEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return !!row?.inboundEnabled;
}

// GET /api/inbound/aliases — list caller's aliases (also returns feature status)
export async function GET(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const db = getDb();
  const enabled = await checkInboundEnabled(db, session.sub);

  const rows = enabled
    ? await db
        .select()
        .from(inboundAliases)
        .where(eq(inboundAliases.ownerUserId, session.sub))
        .all()
    : [];

  return NextResponse.json({
    enabled,
    aliases: rows.map((r) => ({
      ...r,
      fullAddress: fullAddress(r.alias),
    })),
  });
}

// POST /api/inbound/aliases — create a new intake alias
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { entityType?: string; entityId?: string } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    // No body = default user alias
  }

  const aliasType = (body.entityType as "user" | "licence" | "package" | "talent") ?? "user";
  const entityId = body.entityId ?? null;

  if (!["user", "licence", "package", "talent"].includes(aliasType)) {
    return NextResponse.json({ error: "Invalid entityType" }, { status: 400 });
  }

  const db = getDb();

  // Feature gate
  const enabled = await checkInboundEnabled(db, session.sub);
  if (!enabled) {
    return NextResponse.json({ error: "Inbound email is not enabled for your account" }, { status: 403 });
  }
  const now = Math.floor(Date.now() / 1000);

  // Check if an active alias already exists for this user+entity
  const existing = await db
    .select()
    .from(inboundAliases)
    .where(
      entityId
        ? and(
            eq(inboundAliases.ownerUserId, session.sub),
            eq(inboundAliases.ownerEntityId, entityId),
            eq(inboundAliases.status, "active")
          )
        : and(
            eq(inboundAliases.ownerUserId, session.sub),
            eq(inboundAliases.aliasType, "user"),
            eq(inboundAliases.status, "active")
          )
    )
    .get();

  if (existing) {
    return NextResponse.json({
      alias: { ...existing, fullAddress: fullAddress(existing.alias) },
      existing: true,
    });
  }

  const alias = generateAlias(aliasType);
  const id = crypto.randomUUID();

  await db.insert(inboundAliases).values({
    id,
    alias,
    aliasType,
    ownerUserId: session.sub,
    ownerEntityId: entityId,
    status: "active",
    createdAt: now,
  });

  return NextResponse.json(
    {
      alias: {
        id,
        alias,
        aliasType,
        ownerUserId: session.sub,
        ownerEntityId: entityId,
        status: "active",
        fullAddress: fullAddress(alias),
        createdAt: now,
      },
      existing: false,
    },
    { status: 201 }
  );
}
