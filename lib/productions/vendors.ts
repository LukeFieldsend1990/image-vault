/**
 * Production-level vendor onboarding.
 *
 * Attaches vendor organisations (VFX, dubbing, scan service, …) to a production.
 * This is the "who's working on this" link — it does NOT grant scan-data access.
 * Actual access stays per-licence via vendorAuthorisations and is gated by the
 * organisation's environment audit (vendorAuditPassed).
 */

import { eq, and, isNull, gt, ne } from "drizzle-orm";
import {
  productionVendors, organisations, organisationMembers, users, invites, productionCountries,
} from "@/lib/db/schema";
import { isVendorOrgType, ORG_TYPE_LABELS, type OrgType } from "@/lib/organisations/orgTypes";
import { createNotification } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import { vendorProductionInviteEmail } from "@/lib/email/templates";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * Propagate a vendor org's country onto a production it's attached to. The
 * vendor processes performer data in its registered country, so that country
 * must be in scope on the production for compliance purposes. Idempotent and
 * safe to call repeatedly:
 *   - vendor has no country yet → no-op (will be applied when the org's
 *     country is set; see syncOrgCountryAcrossProductions below)
 *   - production already in scope for this country → no-op (whether the
 *     existing row was manual or vendor-derived)
 *   - production had this country previously but soft-removed → reactivate
 *     and tag as vendor-derived so it auto-removes again when the vendor
 *     detaches and nothing else needs it
 *   - otherwise → insert a new in_scope row tagged with this vendor attachment
 */
export async function syncVendorCountryOnProduction(
  db: Db,
  opts: { productionId: string; productionVendorId: string; vendorOrgId: string; actorUserId: string },
): Promise<void> {
  const org = await db
    .select({ country: organisations.country, topLevelId: organisations.countryTopLevelId })
    .from(organisations)
    .where(eq(organisations.id, opts.vendorOrgId))
    .get();
  if (!org?.country || !org.topLevelId) return;

  const existing = await db
    .select({ id: productionCountries.id, status: productionCountries.status })
    .from(productionCountries)
    .where(and(
      eq(productionCountries.productionId, opts.productionId),
      eq(productionCountries.name, org.country),
    ))
    .get();

  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    if (existing.status === "in_scope") return;
    // Soft-removed row → reactivate. Tag with this vendor so a later detach
    // can re-evaluate whether the row is still needed.
    await db
      .update(productionCountries)
      .set({ status: "in_scope", addedAt: now, addedBy: opts.actorUserId, removedAt: null, removedBy: null, addedViaVendorId: opts.productionVendorId })
      .where(eq(productionCountries.id, existing.id));
    return;
  }

  await db.insert(productionCountries).values({
    id: crypto.randomUUID(),
    productionId: opts.productionId,
    name: org.country,
    topLevelId: org.topLevelId,
    isHome: false,
    status: "in_scope",
    addedAt: now,
    addedBy: opts.actorUserId,
    addedViaVendorId: opts.productionVendorId,
  });
}

/**
 * After an org's country is set (or changed), reflect it on every production
 * it's attached to as an active vendor. Used by the org country PATCH so
 * vendors that signed up before picking their country (and thus had no
 * country at attach time) still propagate it once they finish onboarding.
 */
export async function syncOrgCountryAcrossProductions(db: Db, orgId: string): Promise<void> {
  const rows = await db
    .select({ id: productionVendors.id, productionId: productionVendors.productionId, addedBy: productionVendors.addedBy })
    .from(productionVendors)
    .where(and(eq(productionVendors.vendorOrgId, orgId), eq(productionVendors.status, "active")))
    .all();
  for (const row of rows) {
    await syncVendorCountryOnProduction(db, {
      productionId: row.productionId,
      productionVendorId: row.id,
      vendorOrgId: orgId,
      actorUserId: row.addedBy,
    });
  }
}

/**
 * Counterpart to syncVendorCountryOnProduction: when a vendor is detached
 * (revoked / pending-cancelled), drop the production_countries row that this
 * vendor caused — but only if no other active vendor on the same production
 * still needs that country, and only if the row wasn't already in scope for
 * an independent reason (home country or manual add). Soft-remove preserves
 * the audit trail.
 */
export async function unsyncVendorCountryOnProduction(
  db: Db,
  opts: { productionId: string; productionVendorId: string; vendorOrgId: string | null; actorUserId: string },
): Promise<void> {
  if (!opts.vendorOrgId) return;
  const org = await db
    .select({ country: organisations.country })
    .from(organisations)
    .where(eq(organisations.id, opts.vendorOrgId))
    .get();
  if (!org?.country) return;

  const row = await db
    .select({ id: productionCountries.id, isHome: productionCountries.isHome, status: productionCountries.status, addedViaVendorId: productionCountries.addedViaVendorId })
    .from(productionCountries)
    .where(and(
      eq(productionCountries.productionId, opts.productionId),
      eq(productionCountries.name, org.country),
    ))
    .get();
  if (!row) return;
  if (row.status !== "in_scope") return;
  if (row.isHome) return;
  // Manually-added (no vendor link) → never auto-remove.
  if (!row.addedViaVendorId) return;

  // Some other active vendor on this production might still need it. Look
  // for any vendor whose org's country matches.
  const others = await db
    .select({ orgCountry: organisations.country })
    .from(productionVendors)
    .innerJoin(organisations, eq(organisations.id, productionVendors.vendorOrgId))
    .where(and(
      eq(productionVendors.productionId, opts.productionId),
      eq(productionVendors.status, "active"),
      ne(productionVendors.id, opts.productionVendorId),
    ))
    .all();
  if (others.some((o) => o.orgCountry === org.country)) return;

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(productionCountries)
    .set({ status: "removed", removedAt: now, removedBy: opts.actorUserId })
    .where(eq(productionCountries.id, row.id));
}


function vendorTypeLabel(t: string): string {
  return ORG_TYPE_LABELS[t as OrgType] ?? "Vendor";
}

export interface AttachVendorResult {
  ok: boolean;
  message: string;
  mode?: "attached" | "invited";
}

/**
 * Attach a vendor to a production — an existing vendor org (`vendorOrgId`) or a
 * new vendor invited by email (`email` + `orgName` + `vendorType`).
 */
export async function attachVendor(
  db: Db,
  opts: {
    productionId: string;
    productionName: string;
    companyName: string;
    actorUserId: string;
    baseUrl: string;
    vendorOrgId?: string;
    email?: string;
    orgName?: string;
    vendorType?: string;
  },
): Promise<AttachVendorResult> {
  const now = Math.floor(Date.now() / 1000);
  const productionUrl = `${opts.baseUrl}/productions/${opts.productionId}`;

  // Existing vendor org → attach + notify its owners/admins.
  if (opts.vendorOrgId) {
    const org = await db
      .select({ id: organisations.id, name: organisations.name, orgType: organisations.orgType })
      .from(organisations)
      .where(eq(organisations.id, opts.vendorOrgId))
      .get();
    if (!org) return { ok: false, message: "Organisation not found." };
    if (!isVendorOrgType(org.orgType)) return { ok: false, message: `${org.name} is not a vendor organisation.` };

    const existing = await db
      .select({ id: productionVendors.id, status: productionVendors.status })
      .from(productionVendors)
      .where(and(eq(productionVendors.productionId, opts.productionId), eq(productionVendors.vendorOrgId, org.id)))
      .get();
    if (existing && existing.status === "active") return { ok: false, message: `${org.name} is already attached to this production.` };

    let productionVendorId: string;
    if (existing) {
      productionVendorId = existing.id;
      await db.update(productionVendors).set({ status: "active", revokedAt: null, addedBy: opts.actorUserId, addedAt: now })
        .where(eq(productionVendors.id, existing.id));
    } else {
      productionVendorId = crypto.randomUUID();
      await db.insert(productionVendors).values({
        id: productionVendorId,
        productionId: opts.productionId,
        vendorOrgId: org.id,
        vendorType: org.orgType,
        status: "active",
        addedBy: opts.actorUserId,
        addedAt: now,
      });
    }

    // Propagate the vendor's country onto the production's in-scope list.
    // No-op if the org hasn't picked a country yet — it'll sync once the
    // vendor finishes /org-onboarding (see syncOrgCountryAcrossProductions).
    await syncVendorCountryOnProduction(db, {
      productionId: opts.productionId,
      productionVendorId,
      vendorOrgId: org.id,
      actorUserId: opts.actorUserId,
    });

    void notifyVendorOrg(db, { vendorOrgId: org.id, productionName: opts.productionName, companyName: opts.companyName, vendorType: org.orgType, productionUrl });
    return { ok: true, mode: "attached", message: `Attached ${org.name}.` };
  }

  // New vendor by email → pending row + industry signup invite carrying the type.
  const email = (opts.email ?? "").trim().toLowerCase();
  const orgName = (opts.orgName ?? "").trim();
  const vendorType = opts.vendorType ?? "";
  if (!email || !email.includes("@")) return { ok: false, message: "A valid email is required." };
  if (!orgName) return { ok: false, message: "The vendor's company name is required." };
  if (!isVendorOrgType(vendorType)) return { ok: false, message: "Choose a valid vendor type." };

  const existingUser = await db
    .select({ id: users.id, role: users.role, trueRole: users.trueRole })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (existingUser) {
    return { ok: false, message: `${email} already has an account — ask them for their organisation so you can attach it directly.` };
  }

  const pending = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, email), eq(invites.role, "industry"), isNull(invites.usedAt), gt(invites.expiresAt, now)))
    .get();
  if (pending) return { ok: false, message: `${email} already has a pending invite.` };

  const inviteId = crypto.randomUUID();
  await db.insert(invites).values({
    id: inviteId,
    email,
    role: "industry",
    invitedBy: opts.actorUserId,
    talentId: null,
    message: `${opts.companyName} added you to ${opts.productionName} as a ${vendorTypeLabel(vendorType)}.`,
    usedAt: null,
    expiresAt: now + SEVEN_DAYS,
    createdAt: now,
    productionId: opts.productionId,
    orgSubtype: vendorType, // carries the vendor org type through signup
  });

  await db.insert(productionVendors).values({
    id: crypto.randomUUID(),
    productionId: opts.productionId,
    vendorOrgId: null,
    vendorType,
    invitedEmail: email,
    invitedOrgName: orgName,
    inviteId,
    status: "pending",
    addedBy: opts.actorUserId,
    addedAt: now,
  });

  const { subject, html } = vendorProductionInviteEmail({
    recipientEmail: email,
    productionName: opts.productionName,
    companyName: opts.companyName,
    vendorTypeLabel: vendorTypeLabel(vendorType),
    existing: false,
    signupUrl: `${opts.baseUrl}/signup?invite=${inviteId}`,
    productionUrl,
  });
  await sendEmail({ to: email, subject, html }).catch(() => {});

  return { ok: true, mode: "invited", message: `Invited ${email} (expires in 7 days).` };
}

async function notifyVendorOrg(
  db: Db,
  opts: { vendorOrgId: string; productionName: string; companyName: string; vendorType: string; productionUrl: string },
): Promise<void> {
  try {
    const href = opts.productionUrl.replace(/^https?:\/\/[^/]+/, "");
    // Notify the vendor org's owners/admins (in-app + email).
    const recipients = await db
      .select({ userId: users.id, email: users.email, memberRole: organisationMembers.memberRole })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(eq(organisationMembers.organisationId, opts.vendorOrgId))
      .all();
    const managers = recipients.filter((r) => r.memberRole === "owner" || r.memberRole === "admin");

    await Promise.all(managers.map((m) =>
      createNotification(db, {
        userId: m.userId,
        type: "vendor_attached",
        title: `Added to ${opts.productionName}`,
        body: `${opts.companyName} added your organisation to ${opts.productionName} as a ${vendorTypeLabel(opts.vendorType)}.`,
        href,
      }),
    ));

    await Promise.all(managers.map((m) => {
      const { subject, html } = vendorProductionInviteEmail({
        recipientEmail: m.email,
        productionName: opts.productionName,
        companyName: opts.companyName,
        vendorTypeLabel: vendorTypeLabel(opts.vendorType),
        existing: true,
        signupUrl: opts.productionUrl,
        productionUrl: opts.productionUrl,
      });
      return sendEmail({ to: m.email, subject, html }).catch(() => {});
    }));
  } catch {
    // best-effort
  }
}

export interface VendorRow {
  id: string;
  vendorOrgId: string | null;
  vendorType: string;
  status: string;
  orgName: string | null;
  orgShortCode: string | null;
  vendorAuditPassed: boolean | null;
  invitedEmail: string | null;
  invitedOrgName: string | null;
  addedAt: number;
}

/** List a production's attached + pending vendors with org + audit detail. */
export async function listProductionVendors(db: Db, productionId: string): Promise<VendorRow[]> {
  const rows = await db
    .select({
      id: productionVendors.id,
      vendorOrgId: productionVendors.vendorOrgId,
      vendorType: productionVendors.vendorType,
      status: productionVendors.status,
      invitedEmail: productionVendors.invitedEmail,
      invitedOrgName: productionVendors.invitedOrgName,
      addedAt: productionVendors.addedAt,
      orgName: organisations.name,
      orgShortCode: organisations.shortCode,
      vendorAuditPassed: organisations.vendorAuditPassed,
    })
    .from(productionVendors)
    .leftJoin(organisations, eq(organisations.id, productionVendors.vendorOrgId))
    .where(eq(productionVendors.productionId, productionId))
    .all();
  // Hide revoked from the panel.
  return rows.filter((r) => r.status !== "revoked");
}
