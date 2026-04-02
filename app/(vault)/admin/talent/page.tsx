export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { users, talentProfiles, talentSettings, talentReps, scanPackages } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export default async function AdminTalentPage() {
  await requireAdmin();
  const db = getDb();

  // All talent users with profiles and settings
  const talentUsers = await db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(users)
    .where(eq(users.role, "talent"))
    .orderBy(sql`created_at desc`)
    .all();

  const talentIds = talentUsers.map((u) => u.id);

  if (talentIds.length === 0) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Talent Settings</h1>
        </div>
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>No talent users yet.</p>
      </div>
    );
  }

  const [profiles, settings, repCounts, pkgCounts] = await Promise.all([
    db.select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName, profileImageUrl: talentProfiles.profileImageUrl })
      .from(talentProfiles).all(),

    db.select({
      talentId: talentSettings.talentId,
      pipelineEnabled: talentSettings.pipelineEnabled,
      talentSharePct: talentSettings.talentSharePct,
      agencySharePct: talentSettings.agencySharePct,
      platformSharePct: talentSettings.platformSharePct,
    }).from(talentSettings).all(),

    db.select({ talentId: talentReps.talentId, n: sql<number>`count(*)` })
      .from(talentReps).groupBy(talentReps.talentId).all(),

    db.select({ talentId: scanPackages.talentId, n: sql<number>`count(*)` })
      .from(scanPackages).where(eq(scanPackages.status, "ready")).groupBy(scanPackages.talentId).all(),
  ]);

  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const settingsMap = new Map(settings.map((s) => [s.talentId, s]));
  const repCountMap = new Map(repCounts.map((r) => [r.talentId, r.n]));
  const pkgCountMap = new Map(pkgCounts.map((p) => [p.talentId, p.n]));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Talent Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {talentUsers.length} talent account{talentUsers.length !== 1 ? "s" : ""}. Configure pipeline access, fee splits and licence permissions.
        </p>
      </div>

      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
          style={{
            gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Talent</span>
          <span>Pipeline</span>
          <span>Split</span>
          <span>Reps</span>
          <span>Packages</span>
          <span></span>
        </div>

        {talentUsers.map((u) => {
          const profile = profileMap.get(u.id);
          const s = settingsMap.get(u.id);
          const pipelineOn = s?.pipelineEnabled ?? true;
          const split = `${s?.talentSharePct ?? 65}/${s?.agencySharePct ?? 20}/${s?.platformSharePct ?? 15}`;
          const repCount = repCountMap.get(u.id) ?? 0;
          const pkgCount = pkgCountMap.get(u.id) ?? 0;
          const displayName = profile?.fullName ?? u.email;

          return (
            <div
              key={u.id}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[800px]"
              style={{
                gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr",
                borderColor: "var(--color-border)",
              }}
            >
              {/* Avatar + name */}
              <div className="flex items-center gap-3 min-w-0">
                {profile?.profileImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.profileImageUrl}
                    alt={displayName}
                    className="shrink-0 rounded-full object-cover"
                    style={{ width: 28, height: 28 }}
                  />
                ) : (
                  <div
                    className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ width: 28, height: 28, background: "var(--color-ink)" }}
                  >
                    {u.email[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>{displayName}</p>
                  {profile?.fullName && (
                    <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>{u.email}</p>
                  )}
                </div>
              </div>

              {/* Pipeline badge */}
              <span
                className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                style={{
                  background: pipelineOn ? "#16653418" : "#99161618",
                  color: pipelineOn ? "#166534" : "#991b1b",
                }}
              >
                {pipelineOn ? "On" : "Off"}
              </span>

              {/* Split chip */}
              <span
                className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded w-fit"
                style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
              >
                {split}
              </span>

              {/* Rep count */}
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {repCount > 0 ? `${repCount} rep${repCount !== 1 ? "s" : ""}` : "—"}
              </span>

              {/* Package count */}
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {pkgCount > 0 ? `${pkgCount} ready` : "—"}
              </span>

              {/* Manage link */}
              <Link
                href={`/admin/talent/${u.id}`}
                className="text-xs font-medium transition hover:opacity-80 text-right"
                style={{ color: "var(--color-accent)" }}
              >
                Manage →
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
