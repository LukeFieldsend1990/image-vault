import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { licences, users, scrubAttestations, bridgeGrants } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";
import ScrubAdminClient from "./scrub-admin-client";

export type ScrubRow = {
  id: string;
  projectName: string;
  productionCompany: string;
  status: string;
  scrubDeadline: number | null;
  daysRemaining: number | null;
  talentEmail: string;
  licenseeEmail: string;
  attestation: {
    attestedAt: number;
    attestedByEmail: string;
    devicesScrubbed: string[];
    bridgeCachePurged: boolean;
    additionalNotes: string | null;
    ipAddress: string | null;
  } | null;
  bridgeGrants: { total: number; purgeCompleted: number };
};

export default async function AdminScrubPage() {
  await requireAdmin();
  const db = getDb();

  const rows = await db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionCompany: licences.productionCompany,
      status: licences.status,
      scrubDeadline: licences.scrubDeadline,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
    })
    .from(licences)
    .where(inArray(licences.status, ["SCRUB_PERIOD", "OVERDUE", "CLOSED"]))
    .orderBy(sql`${licences.scrubDeadline} asc`)
    .all();

  const licenceIds = rows.map((r) => r.id);

  const userIdSet = new Set<string>();
  for (const r of rows) { userIdSet.add(r.talentId); userIdSet.add(r.licenseeId); }
  const userIds = Array.from(userIdSet);

  const [userRows, attestationRows, grantRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds)).all()
      : Promise.resolve([] as { id: string; email: string }[]),
    licenceIds.length > 0
      ? db
          .select({
            licenceId: scrubAttestations.licenceId,
            attestedAt: scrubAttestations.attestedAt,
            attestedBy: scrubAttestations.attestedBy,
            devicesScrubbed: scrubAttestations.devicesScrubbed,
            bridgeCachePurged: scrubAttestations.bridgeCachePurged,
            additionalNotes: scrubAttestations.additionalNotes,
            ipAddress: scrubAttestations.ipAddress,
          })
          .from(scrubAttestations)
          .where(inArray(scrubAttestations.licenceId, licenceIds))
          .orderBy(sql`${scrubAttestations.attestedAt} desc`)
          .all()
      : Promise.resolve([] as {
          licenceId: string; attestedAt: number; attestedBy: string;
          devicesScrubbed: string | null; bridgeCachePurged: boolean;
          additionalNotes: string | null; ipAddress: string | null;
        }[]),
    licenceIds.length > 0
      ? db
          .select({ licenceId: bridgeGrants.licenceId, purgeCompletedAt: bridgeGrants.purgeCompletedAt })
          .from(bridgeGrants)
          .where(inArray(bridgeGrants.licenceId, licenceIds))
          .all()
      : Promise.resolve([] as { licenceId: string; purgeCompletedAt: number | null }[]),
  ]);

  const emailMap = new Map(userRows.map((u) => [u.id, u.email]));

  // Latest attestation per licence (results already desc by attestedAt)
  const attestationMap = new Map<string, typeof attestationRows[0]>();
  for (const a of attestationRows) {
    if (!attestationMap.has(a.licenceId)) attestationMap.set(a.licenceId, a);
  }

  // Bridge grant counts per licence
  const grantTotals = new Map<string, { total: number; purgeCompleted: number }>();
  for (const g of grantRows) {
    const cur = grantTotals.get(g.licenceId) ?? { total: 0, purgeCompleted: 0 };
    cur.total++;
    if (g.purgeCompletedAt != null) cur.purgeCompleted++;
    grantTotals.set(g.licenceId, cur);
  }

  // Resolve attestedBy emails
  const attestedByIds = [...new Set(
    Array.from(attestationMap.values()).map((a) => a.attestedBy).filter(Boolean)
  )];
  const attestedByUsers = attestedByIds.length > 0
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, attestedByIds)).all()
    : [];
  const attestedByEmailMap = new Map(attestedByUsers.map((u) => [u.id, u.email]));

  const now = Math.floor(Date.now() / 1000);

  const data: ScrubRow[] = rows.map((r) => {
    const att = attestationMap.get(r.id);
    const grants = grantTotals.get(r.id) ?? { total: 0, purgeCompleted: 0 };
    const daysRemaining = r.scrubDeadline != null
      ? Math.ceil((r.scrubDeadline - now) / 86400)
      : null;

    return {
      id: r.id,
      projectName: r.projectName,
      productionCompany: r.productionCompany,
      status: r.status ?? "SCRUB_PERIOD",
      scrubDeadline: r.scrubDeadline ?? null,
      daysRemaining,
      talentEmail: emailMap.get(r.talentId) ?? r.talentId.slice(0, 8),
      licenseeEmail: emailMap.get(r.licenseeId) ?? r.licenseeId.slice(0, 8),
      attestation: att
        ? {
            attestedAt: att.attestedAt,
            attestedByEmail: attestedByEmailMap.get(att.attestedBy) ?? att.attestedBy,
            devicesScrubbed: (() => {
              try { return JSON.parse(att.devicesScrubbed ?? "[]") as string[]; }
              catch { return []; }
            })(),
            bridgeCachePurged: att.bridgeCachePurged,
            additionalNotes: att.additionalNotes,
            ipAddress: att.ipAddress,
          }
        : null,
      bridgeGrants: grants,
    };
  });

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Admin · Licences
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Scrub Attestations</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {data.length} licence{data.length !== 1 ? "s" : ""} in scrub window — deletion confirmations and bridge purge status.
        </p>
      </div>
      <ScrubAdminClient rows={data} />
    </div>
  );
}
