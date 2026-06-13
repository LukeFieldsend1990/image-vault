/**
 * Read-only visibility tools. Available to both "read" and "admin" scope
 * tokens. These never change platform state.
 */

import { registerMcpTool } from "../registry";
import {
  users,
  scanPackages,
  licences,
  downloadEvents,
  bridgeEvents,
  aiCostLog,
  mcpAuditLog,
} from "@/lib/db/schema";
import { desc, eq, gte, sql, and, like } from "drizzle-orm";

const DAY = 24 * 60 * 60;

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

registerMcpTool({
  name: "get_platform_overview",
  description:
    "Snapshot of platform health: user counts by role, package totals, licence counts by status, " +
    "14-day AI spend against budget, and critical bridge events in the last 7 days. Start here.",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
  async execute({ db }) {
    const now = Math.floor(Date.now() / 1000);
    const [roleRows, pkgRow, licenceRows, aiRow, bridgeRow] = await Promise.all([
      db.select({ role: users.role, count: sql<number>`count(*)` }).from(users).groupBy(users.role).all(),
      db.select({
        total: sql<number>`count(*)`,
        deleted: sql<number>`sum(case when ${scanPackages.deletedAt} is not null then 1 else 0 end)`,
        ready: sql<number>`sum(case when ${scanPackages.status} = 'ready' and ${scanPackages.deletedAt} is null then 1 else 0 end)`,
      }).from(scanPackages).get(),
      db.select({ status: licences.status, count: sql<number>`count(*)` }).from(licences).groupBy(licences.status).all(),
      db.select({
        costUsd: sql<number>`coalesce(sum(${aiCostLog.estimatedCostUsd}), 0)`,
        calls: sql<number>`count(*)`,
        errors: sql<number>`sum(case when ${aiCostLog.error} is not null then 1 else 0 end)`,
      }).from(aiCostLog).where(gte(aiCostLog.createdAt, now - 14 * DAY)).get(),
      db.select({ count: sql<number>`count(*)` })
        .from(bridgeEvents)
        .where(and(gte(bridgeEvents.createdAt, now - 7 * DAY), eq(bridgeEvents.severity, "critical")))
        .get(),
    ]);

    const data = {
      usersByRole: Object.fromEntries(roleRows.map((r) => [r.role, r.count])),
      packages: pkgRow,
      licencesByStatus: Object.fromEntries(licenceRows.map((r) => [r.status, r.count])),
      ai14d: aiRow,
      criticalBridgeEvents7d: bridgeRow?.count ?? 0,
    };
    return { success: true, message: "Platform overview generated.", data };
  },
});

registerMcpTool({
  name: "list_users",
  description: "List users with their role, status flags and creation date. Filter by role or email substring.",
  inputSchema: {
    type: "object",
    properties: {
      role: { type: "string", enum: ["talent", "rep", "industry", "licensee", "admin"], description: "Filter by role" },
      search: { type: "string", description: "Email substring filter" },
      limit: { type: "number", description: "Max rows (default 50, max 200)" },
    },
  },
  mutating: false,
  async execute({ db }, params) {
    const conditions = [];
    if (typeof params.role === "string") conditions.push(eq(users.role, params.role as "talent"));
    if (typeof params.search === "string" && params.search.trim()) {
      conditions.push(like(users.email, `%${params.search.trim()}%`));
    }
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        suspendedAt: users.suspendedAt,
        vaultLocked: users.vaultLocked,
        emailMuted: users.emailMuted,
        aiDisabled: users.aiDisabled,
        inboundEnabled: users.inboundEnabled,
        createdAt: sql<number>`cast(${users.createdAt} as integer)`,
      })
      .from(users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(clampLimit(params.limit, 50, 200))
      .all();
    return { success: true, message: `${rows.length} user(s).`, data: { users: rows } };
  },
});

registerMcpTool({
  name: "get_user",
  description: "Full detail for one user (by email): flags, package count, licence counts, recent download activity.",
  inputSchema: {
    type: "object",
    properties: { email: { type: "string", description: "Exact user email" } },
    required: ["email"],
  },
  mutating: false,
  async execute({ db }, params) {
    const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
    if (!email) return { success: false, message: "email is required." };

    const user = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        phone: users.phone,
        suspendedAt: users.suspendedAt,
        vaultLocked: users.vaultLocked,
        emailMuted: users.emailMuted,
        aiDisabled: users.aiDisabled,
        inboundEnabled: users.inboundEnabled,
        geoFingerprintEnabled: users.geoFingerprintEnabled,
        royaltyMeterEnabled: users.royaltyMeterEnabled,
        complianceEnabled: users.complianceEnabled,
        createdAt: sql<number>`cast(${users.createdAt} as integer)`,
      })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (!user) return { success: false, message: `No user with email ${email}.` };

    const [pkgRow, talentLicRow, licenseeLicRow, dlRow] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(scanPackages)
        .where(eq(scanPackages.talentId, user.id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(licences)
        .where(eq(licences.talentId, user.id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(licences)
        .where(eq(licences.licenseeId, user.id)).get(),
      db.select({ count: sql<number>`count(*)` }).from(downloadEvents)
        .where(eq(downloadEvents.licenseeId, user.id)).get(),
    ]);

    return {
      success: true,
      message: `User ${email} (${user.role}).`,
      data: {
        user,
        packageCount: pkgRow?.count ?? 0,
        licencesAsTalent: talentLicRow?.count ?? 0,
        licencesAsLicensee: licenseeLicRow?.count ?? 0,
        downloadCount: dlRow?.count ?? 0,
      },
    };
  },
});

registerMcpTool({
  name: "list_licences",
  description: "List licences with talent/licensee emails. Filter by status and/or participant email.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["AWAITING_PACKAGE", "PENDING", "APPROVED", "DENIED", "REVOKED", "EXPIRED", "SCRUB_PERIOD", "CLOSED", "OVERDUE"],
        description: "Filter by licence status",
      },
      participantEmail: { type: "string", description: "Filter to licences where this email is the talent or licensee" },
      limit: { type: "number", description: "Max rows (default 50, max 200)" },
    },
  },
  mutating: false,
  async execute({ db }, params) {
    const conditions = [];
    if (typeof params.status === "string") conditions.push(eq(licences.status, params.status as "PENDING"));
    if (typeof params.participantEmail === "string" && params.participantEmail.trim()) {
      const email = params.participantEmail.trim().toLowerCase();
      conditions.push(sql`(
        (SELECT email FROM users WHERE id = ${licences.talentId}) = ${email}
        OR (SELECT email FROM users WHERE id = ${licences.licenseeId}) = ${email}
      )`);
    }
    const rows = await db
      .select({
        id: licences.id,
        status: licences.status,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        licenceType: licences.licenceType,
        validFrom: licences.validFrom,
        validTo: licences.validTo,
        agreedFee: licences.agreedFee,
        proposedFee: licences.proposedFee,
        downloadCount: licences.downloadCount,
        talentEmail: sql<string>`(SELECT email FROM users WHERE id = ${licences.talentId})`,
        licenseeEmail: sql<string>`(SELECT email FROM users WHERE id = ${licences.licenseeId})`,
        createdAt: licences.createdAt,
      })
      .from(licences)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(licences.createdAt))
      .limit(clampLimit(params.limit, 50, 200))
      .all();
    return { success: true, message: `${rows.length} licence(s).`, data: { licences: rows } };
  },
});

registerMcpTool({
  name: "list_packages",
  description: "List scan packages with talent email, status, size and soft-delete state.",
  inputSchema: {
    type: "object",
    properties: {
      talentEmail: { type: "string", description: "Filter by owning talent email" },
      includeDeleted: { type: "boolean", description: "Include soft-deleted packages (default false)" },
      limit: { type: "number", description: "Max rows (default 50, max 200)" },
    },
  },
  mutating: false,
  async execute({ db }, params) {
    const conditions = [];
    if (params.includeDeleted !== true) conditions.push(sql`${scanPackages.deletedAt} IS NULL`);
    if (typeof params.talentEmail === "string" && params.talentEmail.trim()) {
      const email = params.talentEmail.trim().toLowerCase();
      conditions.push(sql`(SELECT email FROM users WHERE id = ${scanPackages.talentId}) = ${email}`);
    }
    const rows = await db
      .select({
        id: scanPackages.id,
        name: scanPackages.name,
        status: scanPackages.status,
        scanType: scanPackages.scanType,
        totalSizeBytes: scanPackages.totalSizeBytes,
        deletedAt: scanPackages.deletedAt,
        talentEmail: sql<string>`(SELECT email FROM users WHERE id = ${scanPackages.talentId})`,
        createdAt: scanPackages.createdAt,
      })
      .from(scanPackages)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(scanPackages.createdAt))
      .limit(clampLimit(params.limit, 50, 200))
      .all();
    return { success: true, message: `${rows.length} package(s).`, data: { packages: rows } };
  },
});

registerMcpTool({
  name: "get_security_events",
  description:
    "Recent security-relevant events: bridge events (tamper, hash mismatch, purge…) and download events, newest first.",
  inputSchema: {
    type: "object",
    properties: {
      days: { type: "number", description: "Look-back window in days (default 7, max 90)" },
      severity: { type: "string", enum: ["info", "warn", "critical"], description: "Minimum bridge-event severity filter" },
      limit: { type: "number", description: "Max rows per category (default 50, max 200)" },
    },
  },
  mutating: false,
  async execute({ db }, params) {
    const days = clampLimit(params.days, 7, 90);
    const limit = clampLimit(params.limit, 50, 200);
    const since = Math.floor(Date.now() / 1000) - days * DAY;

    const severityFilter =
      params.severity === "critical" ? ["critical"]
      : params.severity === "warn" ? ["warn", "critical"]
      : null;

    const [bridge, downloads] = await Promise.all([
      db.select({
        id: bridgeEvents.id,
        eventType: bridgeEvents.eventType,
        severity: bridgeEvents.severity,
        detail: bridgeEvents.detail,
        userEmail: sql<string | null>`(SELECT email FROM users WHERE id = ${bridgeEvents.userId})`,
        packageName: sql<string | null>`(SELECT name FROM scan_packages WHERE id = ${bridgeEvents.packageId})`,
        createdAt: bridgeEvents.createdAt,
      })
        .from(bridgeEvents)
        .where(gte(bridgeEvents.createdAt, since))
        .orderBy(desc(bridgeEvents.createdAt))
        .limit(limit)
        .all(),
      db.select({
        id: downloadEvents.id,
        ip: downloadEvents.ip,
        bytesTransferred: downloadEvents.bytesTransferred,
        licenseeEmail: sql<string>`(SELECT email FROM users WHERE id = ${downloadEvents.licenseeId})`,
        filename: sql<string | null>`(SELECT filename FROM scan_files WHERE id = ${downloadEvents.fileId})`,
        startedAt: downloadEvents.startedAt,
      })
        .from(downloadEvents)
        .where(gte(downloadEvents.startedAt, since))
        .orderBy(desc(downloadEvents.startedAt))
        .limit(limit)
        .all(),
    ]);

    const bridgeFiltered = severityFilter ? bridge.filter((e) => severityFilter.includes(e.severity)) : bridge;
    return {
      success: true,
      message: `${bridgeFiltered.length} bridge event(s), ${downloads.length} download(s) in the last ${days} day(s).`,
      data: { bridgeEvents: bridgeFiltered, downloadEvents: downloads },
    };
  },
});

registerMcpTool({
  name: "get_ai_costs",
  description: "AI spend over a window: total cost, call/error counts, and breakdown by provider and feature. Budget is $1.00 per rolling 14 days.",
  inputSchema: {
    type: "object",
    properties: { days: { type: "number", description: "Look-back window in days (default 14, max 90)" } },
  },
  mutating: false,
  async execute({ db }, params) {
    const days = clampLimit(params.days, 14, 90);
    const since = Math.floor(Date.now() / 1000) - days * DAY;

    const [totals, byFeature] = await Promise.all([
      db.select({
        costUsd: sql<number>`coalesce(sum(${aiCostLog.estimatedCostUsd}), 0)`,
        calls: sql<number>`count(*)`,
        errors: sql<number>`sum(case when ${aiCostLog.error} is not null then 1 else 0 end)`,
      }).from(aiCostLog).where(gte(aiCostLog.createdAt, since)).get(),
      db.select({
        provider: aiCostLog.provider,
        feature: aiCostLog.feature,
        costUsd: sql<number>`sum(${aiCostLog.estimatedCostUsd})`,
        calls: sql<number>`count(*)`,
      }).from(aiCostLog).where(gte(aiCostLog.createdAt, since))
        .groupBy(aiCostLog.provider, aiCostLog.feature).all(),
    ]);

    return {
      success: true,
      message: `$${(totals?.costUsd ?? 0).toFixed(4)} across ${totals?.calls ?? 0} call(s) in the last ${days} day(s).`,
      data: { windowDays: days, totals, byProviderAndFeature: byFeature },
    };
  },
});

registerMcpTool({
  name: "get_mcp_audit_log",
  description: "Recent MCP tool calls (this integration's own audit trail): who ran what, with what outcome.",
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "Max rows (default 50, max 200)" } },
  },
  mutating: false,
  async execute({ db }, params) {
    const rows = await db
      .select({
        id: mcpAuditLog.id,
        tool: mcpAuditLog.tool,
        paramsJson: mcpAuditLog.paramsJson,
        success: mcpAuditLog.success,
        message: mcpAuditLog.message,
        userEmail: sql<string>`(SELECT email FROM users WHERE id = ${mcpAuditLog.userId})`,
        createdAt: mcpAuditLog.createdAt,
      })
      .from(mcpAuditLog)
      .orderBy(desc(mcpAuditLog.createdAt))
      .limit(clampLimit(params.limit, 50, 200))
      .all();
    return { success: true, message: `${rows.length} audit entrie(s).`, data: { entries: rows } };
  },
});
