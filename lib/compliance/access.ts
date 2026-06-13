// Authorization helpers for the Compliance Layer (SPEC §16.13).
//
// Consent and most compliance writes are talent/rep acts; licensees and admins
// have read visibility (admins everywhere). This centralises the licence-scoped
// check so every compliance route enforces it identically.

import { and, eq } from "drizzle-orm";
import { licences, organisationMembers, productions, talentReps, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/jwt";
import { isAdmin } from "@/lib/auth/adminEmails";
import { isIndustryRole } from "@/lib/auth/roles";

// Admin is determined by the email whitelist (lib/auth/adminEmails), not the JWT
// role — platform admins keep their original role (e.g. talent) and gain admin via
// email. Use this everywhere instead of `session.role === "admin"`.
const isAdminSession = (session: SessionPayload) => session.role === "admin" || isAdmin(session.email);

type Db = ReturnType<typeof getDb>;

// Returns false if the user has compliance access disabled (admins are always allowed).
async function isComplianceEnabled(db: Db, session: SessionPayload): Promise<boolean> {
  if (isAdminSession(session)) return true;
  const row = await db
    .select({ complianceEnabled: users.complianceEnabled })
    .from(users)
    .where(eq(users.id, session.sub))
    .get();
  return row?.complianceEnabled !== false;
}

export interface LicenceParties {
  talentId: string;
  licenseeId: string;
  organisationId: string | null;
}

export type LicenceAccess =
  | { ok: true; licence: LicenceParties }
  | { ok: false; status: number; error: string };

// `write` = grant/revoke consent and similar talent acts (talent/rep/admin only).
// `read`  = view consent/obligations (adds the licensee who holds the licence).
export async function authorizeLicence(
  db: Db,
  session: SessionPayload,
  licenceId: string,
  mode: "read" | "write",
): Promise<LicenceAccess> {
  if (!await isComplianceEnabled(db, session)) {
    return { ok: false, status: 403, error: "Compliance access disabled for this account" };
  }

  const licence = await db
    .select({
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      organisationId: licences.organisationId,
    })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  if (!licence) return { ok: false, status: 404, error: "Licence not found" };

  if (isAdminSession(session)) return { ok: true, licence };

  if (session.role === "talent") {
    return session.sub === licence.talentId
      ? { ok: true, licence }
      : { ok: false, status: 403, error: "Forbidden" };
  }

  if (session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, licence.talentId)))
      .get();
    return link ? { ok: true, licence } : { ok: false, status: 403, error: "Forbidden" };
  }

  if (isIndustryRole(session.role) && mode === "read" && session.sub === licence.licenseeId) {
    return { ok: true, licence };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

// Producer-side acts (attestations 39.E/H, transfer requests 39.I, business
// reason 39.J): the licensee who holds the licence, or an admin.
export async function authorizeProducer(
  db: Db,
  session: SessionPayload,
  licenceId: string,
): Promise<LicenceAccess> {
  if (!await isComplianceEnabled(db, session)) {
    return { ok: false, status: 403, error: "Compliance access disabled for this account" };
  }

  const licence = await db
    .select({
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      organisationId: licences.organisationId,
    })
    .from(licences)
    .where(eq(licences.id, licenceId))
    .get();

  if (!licence) return { ok: false, status: 404, error: "Licence not found" };
  if (isAdminSession(session)) return { ok: true, licence };
  if (isIndustryRole(session.role) && session.sub === licence.licenseeId) {
    return { ok: true, licence };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

// Read authorization for a certificate scope (licence / talent / production).
// Used by the certificate + verify routes.
export async function authorizeScope(
  db: Db,
  session: SessionPayload,
  scope: "licence" | "talent" | "production" | "organisation",
  scopeId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!await isComplianceEnabled(db, session)) {
    return { ok: false, status: 403, error: "Compliance access disabled for this account" };
  }

  if (isAdminSession(session)) return { ok: true };

  if (scope === "licence") {
    const a = await authorizeLicence(db, session, scopeId, "read");
    return a.ok ? { ok: true } : { ok: false, status: a.status, error: a.error };
  }

  if (scope === "talent") {
    if (session.role === "talent" && session.sub === scopeId) return { ok: true };
    if (session.role === "rep") {
      const link = await db
        .select({ id: talentReps.id })
        .from(talentReps)
        .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, scopeId)))
        .get();
      if (link) return { ok: true };
    }
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (scope === "organisation") {
    const member = await db
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(and(
        eq(organisationMembers.organisationId, scopeId),
        eq(organisationMembers.userId, session.sub),
      ))
      .get();
    return member ? { ok: true } : { ok: false, status: 403, error: "Forbidden" };
  }

  if (scope === "production") {
    // Allow org members whose org owns this production.
    const prod = await db
      .select({ organisationId: productions.organisationId })
      .from(productions)
      .where(eq(productions.id, scopeId))
      .get();

    if (prod?.organisationId) {
      const member = await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(and(
          eq(organisationMembers.organisationId, prod.organisationId),
          eq(organisationMembers.userId, session.sub),
        ))
        .get();
      if (member) return { ok: true };
    }

    // Fallback: allow if the user holds at least one licence under this production
    const lic = await db
      .select({ id: licences.id })
      .from(licences)
      .where(and(eq(licences.productionId, scopeId), eq(licences.licenseeId, session.sub)))
      .get();
    if (lic) return { ok: true };

    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}
