/**
 * Claimable licensee stub for anonymous AI clients.
 *
 * An OLP request has no IV account, but `licences.licenseeId` needs a user. We
 * auto-provision an inert, unclaimed licensee (org + user), deduped by a client
 * key (normalised client_id, else contact_email). The stub can never log in
 * (un-verifiable password) and has metered-API access only — never downloads.
 * The real contact_email lives on `rsl_clients` for the claim/verify flow, so we
 * never collide with or hijack a real account's email.
 */
import { eq } from "drizzle-orm";
import { rslClients, users } from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import { resolveCompanyOrg } from "@/lib/organisations/resolveCompany";

type Db = ReturnType<typeof getDb>;

export interface LicenseeRef {
  clientRowId: string;
  licenseeId: string;
  organisationId: string | null;
  blocked: boolean;
}

export function normaliseClientKey(clientId?: string | null, contactEmail?: string | null): string | null {
  const base = clientId && clientId.trim() ? clientId.trim() : (contactEmail ?? "").trim();
  return base ? base.toLowerCase().slice(0, 200) : null;
}

/** Provision (or reuse) the licensee stub for an AI client. */
export async function provisionLicensee(
  db: Db,
  input: { clientId?: string | null; clientName?: string | null; contactEmail?: string | null },
): Promise<LicenseeRef> {
  const key = normaliseClientKey(input.clientId, input.contactEmail);
  if (!key) throw new Error("client key required (client_id or contact_email)");

  const existing = await db.select().from(rslClients).where(eq(rslClients.clientKey, key)).get();
  if (existing) {
    return {
      clientRowId: existing.id,
      licenseeId: existing.licenseeId,
      organisationId: existing.organisationId,
      blocked: !!existing.blockedAt,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const name = (input.clientName && input.clientName.trim()) || input.clientId || input.contactEmail || "AI client";

  // Inert stub user — synthetic unique email (never collides with real users),
  // un-loginable password, flagged unclaimed. The real contact goes on rsl_clients.
  const licenseeId = crypto.randomUUID();
  // role uses the legacy "licensee" value (the users.role DB CHECK only permits
  // legacy values; effective industry role is expressed via that value).
  await db.insert(users).values({
    id: licenseeId,
    email: `olp-${licenseeId}@licensee.changling.io`,
    passwordHash: `!olp-stub-${crypto.randomUUID()}`, // not a valid hash → cannot authenticate
    role: "licensee",
    unclaimedAt: now,
    createdAt: new Date(),
  });

  const org = await resolveCompanyOrg(db, { name, createdBy: licenseeId, orgType: "ai_company" });

  const clientRowId = crypto.randomUUID();
  await db.insert(rslClients).values({
    id: clientRowId,
    clientKey: key,
    licenseeId,
    organisationId: org.organisationId,
    clientName: name.slice(0, 200),
    contactEmail: input.contactEmail?.trim().slice(0, 200) ?? null,
    verified: false,
    createdAt: now,
    updatedAt: now,
  });

  return { clientRowId, licenseeId, organisationId: org.organisationId, blocked: false };
}
