/**
 * Corrective (mutating) tools. The dispatcher in app/api/mcp/route.ts gates
 * every one of these behind an admin-scope token PLUS a fresh per-call TOTP
 * code, and writes an audit entry. Tools here add their own guardrails:
 * admin-whitelisted accounts can never be modified, and the admin role can
 * never be assigned (the whitelist is code-defined by design).
 */

import { registerMcpTool } from "../registry";
import { users, scanPackages, mcpTokens, refreshTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth/adminEmails";
import { SESSION_REVOKED_PREFIX } from "@/lib/auth/requireSession";
import type { McpToolContext, McpToolResult } from "../types";

// Must outlive any session JWT issued before revocation. Session TTL is 2h;
// add a clock-skew buffer.
const SESSION_REVOKE_TTL_SECONDS = 2 * 60 * 60 + 300;

type TargetUser = { id: string; email: string; role: string };

async function findTargetUser(
  ctx: McpToolContext,
  emailParam: unknown
): Promise<TargetUser | McpToolResult> {
  const email = typeof emailParam === "string" ? emailParam.trim().toLowerCase() : "";
  if (!email) return { success: false, message: "email is required." };
  const user = await ctx.db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!user) return { success: false, message: `No user with email ${email}.` };
  if (isAdmin(user.email)) {
    return { success: false, message: "Admin accounts cannot be modified through MCP." };
  }
  return user;
}

function isResult(v: TargetUser | McpToolResult): v is McpToolResult {
  return "success" in v;
}

const USER_FLAGS = {
  vaultLocked: users.vaultLocked,
  emailMuted: users.emailMuted,
  aiDisabled: users.aiDisabled,
  inboundEnabled: users.inboundEnabled,
  geoFingerprintEnabled: users.geoFingerprintEnabled,
  royaltyMeterEnabled: users.royaltyMeterEnabled,
  complianceEnabled: users.complianceEnabled,
} as const;

registerMcpTool({
  name: "set_user_flag",
  description: "Set a per-user feature flag (vaultLocked, emailMuted, aiDisabled, inboundEnabled, geoFingerprintEnabled, royaltyMeterEnabled, complianceEnabled).",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Target user email" },
      flag: { type: "string", enum: Object.keys(USER_FLAGS), description: "Flag to set" },
      value: { type: "boolean", description: "New value" },
    },
    required: ["email", "flag", "value"],
  },
  mutating: true,
  async execute(ctx, params) {
    const target = await findTargetUser(ctx, params.email);
    if (isResult(target)) return target;
    const flag = params.flag as keyof typeof USER_FLAGS;
    if (!(flag in USER_FLAGS)) return { success: false, message: `Unknown flag "${String(params.flag)}".` };
    if (typeof params.value !== "boolean") return { success: false, message: "value must be a boolean." };

    await ctx.db.update(users).set({ [flag]: params.value }).where(eq(users.id, target.id));
    return { success: true, message: `Set ${flag}=${params.value} for ${target.email}.` };
  },
});

registerMcpTool({
  name: "set_user_role",
  description: "Change a user's role to talent, rep or licensee. The admin role can never be assigned (whitelist is code-defined).",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Target user email" },
      role: { type: "string", enum: ["talent", "rep", "industry", "licensee"], description: "New role" },
    },
    required: ["email", "role"],
  },
  mutating: true,
  async execute(ctx, params) {
    const role = params.role;
    if (role !== "talent" && role !== "rep" && role !== "industry" && role !== "licensee") {
      return { success: false, message: 'role must be one of "talent", "rep", "industry", "licensee".' };
    }
    const target = await findTargetUser(ctx, params.email);
    if (isResult(target)) return target;

    await ctx.db.update(users).set({ role }).where(eq(users.id, target.id));
    return { success: true, message: `Changed ${target.email} from ${target.role} to ${role}.` };
  },
});

registerMcpTool({
  name: "set_user_suspended",
  description: "Suspend or unsuspend a user account. Suspended users cannot log in.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Target user email" },
      suspended: { type: "boolean", description: "true to suspend, false to reinstate" },
    },
    required: ["email", "suspended"],
  },
  mutating: true,
  async execute(ctx, params) {
    if (typeof params.suspended !== "boolean") return { success: false, message: "suspended must be a boolean." };
    const target = await findTargetUser(ctx, params.email);
    if (isResult(target)) return target;

    const suspendedAt = params.suspended ? Math.floor(Date.now() / 1000) : null;
    await ctx.db.update(users).set({ suspendedAt }).where(eq(users.id, target.id));
    return {
      success: true,
      message: params.suspended ? `Suspended ${target.email}.` : `Reinstated ${target.email}.`,
    };
  },
});

registerMcpTool({
  name: "restore_package",
  description: "Restore a soft-deleted scan package (clears deletedAt/deletedBy). Use list_packages with includeDeleted=true to find candidates.",
  inputSchema: {
    type: "object",
    properties: { packageId: { type: "string", description: "Package UUID" } },
    required: ["packageId"],
  },
  mutating: true,
  async execute({ db }, params) {
    const packageId = typeof params.packageId === "string" ? params.packageId.trim() : "";
    if (!packageId) return { success: false, message: "packageId is required." };

    const pkg = await db
      .select({ id: scanPackages.id, name: scanPackages.name, deletedAt: scanPackages.deletedAt })
      .from(scanPackages)
      .where(eq(scanPackages.id, packageId))
      .get();
    if (!pkg) return { success: false, message: `No package with id ${packageId}.` };
    if (pkg.deletedAt === null) return { success: false, message: `Package "${pkg.name}" is not deleted.` };

    await db
      .update(scanPackages)
      .set({ deletedAt: null, deletedBy: null, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(scanPackages.id, packageId));
    return { success: true, message: `Restored package "${pkg.name}".` };
  },
});

registerMcpTool({
  name: "revoke_mcp_token",
  description: "Revoke an MCP token by id (kill switch — takes effect on the next request). Tokens are listed at /admin/mcp.",
  inputSchema: {
    type: "object",
    properties: { tokenId: { type: "string", description: "MCP token UUID" } },
    required: ["tokenId"],
  },
  mutating: true,
  async execute({ db }, params) {
    const tokenId = typeof params.tokenId === "string" ? params.tokenId.trim() : "";
    if (!tokenId) return { success: false, message: "tokenId is required." };

    const row = await db
      .select({ id: mcpTokens.id, displayName: mcpTokens.displayName, revokedAt: mcpTokens.revokedAt })
      .from(mcpTokens)
      .where(eq(mcpTokens.id, tokenId))
      .get();
    if (!row) return { success: false, message: `No MCP token with id ${tokenId}.` };
    if (row.revokedAt !== null) return { success: false, message: `Token "${row.displayName}" is already revoked.` };

    await db
      .update(mcpTokens)
      .set({ revokedAt: Math.floor(Date.now() / 1000) })
      .where(eq(mcpTokens.id, tokenId));
    return { success: true, message: `Revoked MCP token "${row.displayName}".` };
  },
});

registerMcpTool({
  name: "lock_talent_downloads",
  description:
    "Lock (or unlock) a talent's vault when they appear to be targeted. While locked, no new licence requests or downloads of that talent's likeness can start, across every licensee and the render bridge. Talent accounts only.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Target talent's account email" },
      locked: { type: "boolean", description: "true to lock the vault, false to unlock" },
      reason: { type: "string", description: "Short reason for the audit trail" },
    },
    required: ["email", "locked"],
  },
  mutating: true,
  async execute(ctx, params) {
    if (typeof params.locked !== "boolean") return { success: false, message: "locked must be a boolean." };
    const target = await findTargetUser(ctx, params.email);
    if (isResult(target)) return target;
    if (target.role !== "talent") {
      return { success: false, message: `${target.email} is a ${target.role} account; vault locking applies to talent only.` };
    }

    await ctx.db.update(users).set({ vaultLocked: params.locked }).where(eq(users.id, target.id));
    const reason = typeof params.reason === "string" && params.reason.trim() ? ` (${params.reason.trim()})` : "";
    return {
      success: true,
      message: params.locked
        ? `Locked ${target.email}'s vault — downloads and new licence requests are blocked${reason}.`
        : `Unlocked ${target.email}'s vault — downloads can resume${reason}.`,
    };
  },
});

registerMcpTool({
  name: "revoke_user_sessions",
  description:
    "Force-logout a user immediately: deletes their refresh tokens and denylists their live session JWT so it stops working within seconds (a stateless JWT otherwise stays valid up to ~2h). Optionally also suspends the account. The user can log in again afterwards unless suspended. Use for suspicious activity.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Target user email" },
      suspend: { type: "boolean", description: "Also suspend the account so they cannot log back in (default false)" },
      reason: { type: "string", description: "Short reason for the audit trail" },
    },
    required: ["email"],
  },
  mutating: true,
  async execute(ctx, params) {
    if (!ctx.kv) return { success: false, message: "Session store unavailable in this context." };
    const target = await findTargetUser(ctx, params.email);
    if (isResult(target)) return target;

    const now = Math.floor(Date.now() / 1000);
    const suspend = params.suspend === true;

    // 1. Stop renewal — drop every refresh token for this user.
    await ctx.db.delete(refreshTokens).where(eq(refreshTokens.userId, target.id));

    // 2. Kill live JWTs — denylist sessions issued before now (requireSession
    //    compares the JWT's iat against this timestamp, so re-login still works).
    await ctx.kv.put(`${SESSION_REVOKED_PREFIX}${target.id}`, String(now), {
      expirationTtl: SESSION_REVOKE_TTL_SECONDS,
    });

    // 3. Optionally block re-login entirely.
    if (suspend) {
      await ctx.db.update(users).set({ suspendedAt: now }).where(eq(users.id, target.id));
    }

    const reason = typeof params.reason === "string" && params.reason.trim() ? ` (${params.reason.trim()})` : "";
    return {
      success: true,
      message: suspend
        ? `Revoked all sessions for ${target.email} and suspended the account${reason}.`
        : `Revoked all sessions for ${target.email}; they must log in again${reason}.`,
    };
  },
});
