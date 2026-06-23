import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { organisations, organisationMembers } from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";
import AgenciesClient, { type AgencyRow } from "./agencies-client";

export default async function AdminAgenciesPage() {
  await requireAdmin();
  const db = getDb();

  const rows = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      shortCode: organisations.shortCode,
      website: organisations.website,
      createdAt: organisations.createdAt,
    })
    .from(organisations)
    .where(eq(organisations.orgType, "agency"))
    .orderBy(desc(organisations.createdAt))
    .all();

  const memberCounts = await db
    .select({ organisationId: organisationMembers.organisationId, n: count() })
    .from(organisationMembers)
    .groupBy(organisationMembers.organisationId)
    .all();
  const countMap = new Map(memberCounts.map((r) => [r.organisationId, r.n]));

  const agencies: AgencyRow[] = rows.map((r) => ({ ...r, memberCount: countMap.get(r.id) ?? 0 }));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Talent Agencies</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Provision an agency and invite its first administrator. Agents are{" "}
          <code>rep</code>-role members who act on behalf of represented performers.
        </p>
      </div>

      <AgenciesClient agencies={agencies} />
    </div>
  );
}
