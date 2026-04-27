export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { AwsClient } from "aws4fetch";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { getDb } from "@/lib/db";
import { licences, scanFiles, users, bridgeGrants, bridgeDevices, bridgeEvents } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  requireBridgeToken,
  isBridgeTokenError,
} from "@/lib/auth/requireBridgeToken";
import {
  resolveAccessWindow,
  recordAccessWindowDownload,
} from "@/lib/bridge/accessWindows";

// ── Configuration ────────────────────────────────────────────────────────────

/** Allowed DCC tools per licence type. */
const TOOLS_BY_LICENCE_TYPE: Record<string, string[]> = {
  film_double:          ["nuke", "houdini", "maya"],
  game_character:       ["houdini", "unreal", "blender"],
  commercial:           ["nuke", "houdini", "maya", "blender"],
  ai_avatar:            ["nuke"],
  training_data:        [],
  monitoring_reference: ["nuke"],
};

/** Presigned source URL validity — 24 h gives the Bridge app a full day to pull files. */
const PRESIGN_TTL_SECS = 86400;

/** Offline grace period after licence expiry: 48 h. */
const OFFLINE_GRACE_SECS = 48 * 3600;

// ── Helpers ──────────────────────────────────────────────────────────────────

function cfEnv(key: string): string | undefined {
  try {
    return (getRequestContext().env as unknown as Record<string, string | undefined>)[key];
  } catch {
    return process.env[key];
  }
}

/**
 * Generate a presigned R2 GET URL valid for `ttlSecs` seconds.
 */
async function presignGet(r2Key: string, ttlSecs: number): Promise<string> {
  const accountId = cfEnv("CF_ACCOUNT_ID")!;
  const bucketName = cfEnv("R2_BUCKET_NAME") ?? "image-vault-scans";
  const r2 = new AwsClient({
    accessKeyId: cfEnv("R2_ACCESS_KEY_ID")!,
    secretAccessKey: cfEnv("R2_SECRET_ACCESS_KEY")!,
    region: "auto",
    service: "s3",
  });
  const url = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`
  );
  url.searchParams.set("X-Amz-Expires", String(ttlSecs));
  const signed = await r2.sign(new Request(url.toString(), { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * Sign a UTF-8 string with P-256 ECDSA / SHA-256.
 * Returns a base64url-encoded signature.
 */
async function signEcdsa(data: string, jwkJson: string): Promise<string> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(data)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/bridge/packages/:packageId/open
 *
 * Issues a signed Bridge grant manifest for the given package + licence.
 *
 * Body: { licenceId: string, deviceId: string, tool: string }
 *
 * Returns: { manifest: string, signature: string, keyId: string, grantId: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> }
) {
  const auth = await requireBridgeToken(req);
  if (isBridgeTokenError(auth)) return auth;

  const { packageId } = await params;

  let body: { licenceId?: string; deviceId?: string; tool?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { licenceId, deviceId, tool } = body;
  if (!licenceId || !deviceId || !tool) {
    return NextResponse.json(
      { error: "licenceId, deviceId, and tool are required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // ── 1. Validate licence ────────────────────────────────────────────────────
  const licence = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      packageId: licences.packageId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      validTo: licences.validTo,
      fileScope: licences.fileScope,
      licenceType: licences.licenceType,
      downloadCount: licences.downloadCount,
    })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  if (!licence) {
    return NextResponse.json({ error: "Licence not found" }, { status: 404 });
  }
  if (licence.licenseeId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.packageId !== packageId) {
    return NextResponse.json({ error: "Package does not match licence" }, { status: 400 });
  }
  if (licence.status !== "APPROVED") {
    void db.insert(bridgeEvents).values({
      id: crypto.randomUUID(),
      grantId: null,
      packageId,
      deviceId,
      userId: auth.userId,
      eventType: "re_access_denied",
      severity: "warn",
      detail: JSON.stringify({ reason: "licence_not_approved", licenceId, status: licence.status }),
      createdAt: now,
    });
    return NextResponse.json({ error: "Licence is not approved" }, { status: 409 });
  }
  if (licence.validTo < now) {
    void db.insert(bridgeEvents).values({
      id: crypto.randomUUID(),
      grantId: null,
      packageId,
      deviceId,
      userId: auth.userId,
      eventType: "re_access_denied",
      severity: "critical",
      detail: JSON.stringify({ reason: "licence_expired", licenceId, expiredAt: licence.validTo }),
      createdAt: now,
    });
    return NextResponse.json({ error: "Licence has expired" }, { status: 409 });
  }

  // ── 2. Check vault lock ────────────────────────────────────────────────────
  const talent = await db
    .select({ vaultLocked: users.vaultLocked })
    .from(users)
    .where(eq(users.id, licence.talentId))
    .get();

  if (talent?.vaultLocked) {
    return NextResponse.json({ error: "This vault is currently locked" }, { status: 423 });
  }

  // ── 3. Validate tool is permitted for this licence type ───────────────────
  const allowedTools = TOOLS_BY_LICENCE_TYPE[licence.licenceType ?? ""] ?? [];
  if (allowedTools.length === 0) {
    return NextResponse.json(
      {
        error: `Licence type '${licence.licenceType ?? "unknown"}' does not permit DCC tool access`,
      },
      { status: 403 }
    );
  }
  if (!allowedTools.includes(tool)) {
    return NextResponse.json(
      {
        error: `Tool '${tool}' is not permitted. Allowed: ${allowedTools.join(", ")}`,
      },
      { status: 403 }
    );
  }

  // ── 4. Access window gating ───────────────────────────────────────────────
  // Time-based expiry is a hard block. Download count is a soft signal: we
  // count past the threshold and surface `exceeded` in the response so the
  // Bridge can warn, but we don't refuse the open.
  const windowState = await resolveAccessWindow(db, licenceId, now);
  if (windowState.kind === "expired") {
    return NextResponse.json(
      {
        error: "access_window_expired",
        message: "The access window for this licence has expired — ask the talent to open a new one.",
      },
      { status: 403 }
    );
  }

  // ── 5. Update device last-seen (log unknown devices, don't block) ─────────
  const device = await db
    .select({ id: bridgeDevices.id, userId: bridgeDevices.userId })
    .from(bridgeDevices)
    .where(eq(bridgeDevices.id, deviceId))
    .get();

  if (device) {
    void db
      .update(bridgeDevices)
      .set({ lastSeenAt: now })
      .where(eq(bridgeDevices.id, deviceId))
      .run();
  }
  // Unknown device is allowed through — recorded in the grant for audit

  // ── 6. Fetch files in scope ────────────────────────────────────────────────
  const allFiles = await db
    .select({
      id: scanFiles.id,
      filename: scanFiles.filename,
      r2Key: scanFiles.r2Key,
      sizeBytes: scanFiles.sizeBytes,
      sha256: scanFiles.sha256,
      uploadStatus: scanFiles.uploadStatus,
    })
    .from(scanFiles)
    .where(eq(scanFiles.packageId, packageId))
    .all();

  const completedFiles = allFiles.filter((f) => f.uploadStatus === "complete");

  let scopedFiles = completedFiles;
  if (licence.fileScope && licence.fileScope !== "all") {
    try {
      const scopeIds = JSON.parse(licence.fileScope) as string[];
      scopedFiles = completedFiles.filter((f) => scopeIds.includes(f.id));
    } catch {
      // malformed fileScope — fall back to all completed files
    }
  }

  if (scopedFiles.length === 0) {
    return NextResponse.json(
      { error: "No completed files found in this package" },
      { status: 404 }
    );
  }

  // ── 7. Build per-file entries with presigned source URLs ──────────────────
  const fileEntries = await Promise.all(
    scopedFiles.map(async (f) => {
      const sourceUrl = await presignGet(f.r2Key, PRESIGN_TTL_SECS);
      return {
        fileId: f.id,
        filename: f.filename,
        path: f.filename, // Bridge organises files in a folder named after the package
        size: f.sizeBytes,
        sha256: f.sha256 ?? null, // null if not yet backfilled — Bridge will skip integrity check
        sourceUrl,
      };
    })
  );

  // ── 8. Build and sign the manifest ────────────────────────────────────────
  const signingKeyJwk = cfEnv("BRIDGE_SIGNING_KEY_JWK");
  if (!signingKeyJwk) {
    return NextResponse.json(
      { error: "Bridge signing key not configured (BRIDGE_SIGNING_KEY_JWK)" },
      { status: 503 }
    );
  }

  const grantId = crypto.randomUUID();
  const expiresAt = licence.validTo;
  const offlineUntil = expiresAt + OFFLINE_GRACE_SECS;

  const manifest = {
    version: "1",
    grantId,
    packageId,
    licenceId,
    allowedTools,
    allowedUserIds: [auth.userId],
    allowedDeviceIds: [deviceId],
    expiresAt,
    offlineUntil,
    files: fileEntries,
  };

  const manifestJson = JSON.stringify(manifest);

  let signature: string;
  try {
    signature = await signEcdsa(manifestJson, signingKeyJwk);
  } catch (err) {
    console.error("Bridge manifest signing failed:", err);
    return NextResponse.json({ error: "Manifest signing failed" }, { status: 500 });
  }

  const keyId = "bridge-signing-key-1";

  // Supersede any prior grant on the same bridge so active-session counts don't pile up.
  await db
    .update(bridgeGrants)
    .set({ revokedAt: now })
    .where(
      and(
        eq(bridgeGrants.licenceId, licenceId),
        eq(bridgeGrants.deviceId, deviceId),
        eq(bridgeGrants.userId, auth.userId),
        isNull(bridgeGrants.revokedAt)
      )
    );

  // ── 9. Record the grant, bump counters, log window download ──────────────
  await db.insert(bridgeGrants).values({
    id: grantId,
    licenceId,
    packageId,
    userId: auth.userId,
    tool,
    deviceId,
    allowedTools: JSON.stringify(allowedTools),
    manifestJson,
    signature,
    keyId,
    expiresAt,
    offlineUntil,
    createdAt: now,
  });

  await db
    .update(licences)
    .set({
      downloadCount: (licence.downloadCount ?? 0) + 1,
      lastDownloadAt: now,
    })
    .where(eq(licences.id, licenceId));

  let windowExceeded = false;
  let windowCrossed = false;
  let windowRemaining: number | undefined;
  if (windowState.kind === "active") {
    const result = await recordAccessWindowDownload(db, {
      window: windowState.window,
      actorId: auth.userId,
      metadata: { grantId, packageId, tool, deviceId },
      now,
    });
    windowExceeded = result.exceeded;
    windowCrossed = result.crossedThreshold;
    windowRemaining = windowState.window.maxDownloads - result.newDownloadsUsed;
  }

  return NextResponse.json({
    manifest: manifestJson,
    signature,
    keyId,
    grantId,
    ...(windowState.kind === "active"
      ? {
          accessWindow: {
            remaining: windowRemaining,
            exceeded: windowExceeded,
            thresholdCrossed: windowCrossed,
          },
        }
      : {}),
  });
}
