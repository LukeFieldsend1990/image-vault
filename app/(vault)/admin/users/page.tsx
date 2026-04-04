export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { users, talentProfiles, scanPackages, talentReps } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import UserActions from "./user-actions";

type Role = "talent" | "rep" | "licensee" | "admin";

const ROLE_LABEL: Record<Role, string> = {
  talent: "Talent",
  rep: "Rep",
  licensee: "Licensee",
  admin: "Admin",
};

const ROLE_COLOR: Record<Role, string> = {
  talent: "#4f46e5",
  rep: "#0891b2",
  licensee: "#059669",
  admin: "#c0392b",
};

function ts(d: Date | number): string {
  const date = typeof d === "number" ? new Date(d * 1000) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function AdminUsersPage() {
  const { userId: currentUserId } = await requireAdmin();
  const db = getDb();

  // All users with package count and talent profile
  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      suspendedAt: users.suspendedAt,
      emailMuted: users.emailMuted,
      aiDisabled: users.aiDisabled,
    })
    .from(users)
    .orderBy(sql`created_at desc`)
    .all();

  // Talent profiles
  const profiles = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName, profileImageUrl: talentProfiles.profileImageUrl })
    .from(talentProfiles)
    .all();
  const profileMap = new Map(profiles.map((p) => [p.userId, p]));

  // Package counts per talent
  const pkgCounts = await db
    .select({ talentId: scanPackages.talentId, n: sql<number>`count(*)` })
    .from(scanPackages)
    .groupBy(scanPackages.talentId)
    .all();
  const pkgCountMap = new Map(pkgCounts.map((p) => [p.talentId, p.n]));

  // Rep relationships
  const repRows = await db.select().from(talentReps).all();
  const repTalentMap = new Map<string, number>(); // repId → talent count
  for (const r of repRows) {
    repTalentMap.set(r.repId, (repTalentMap.get(r.repId) ?? 0) + 1);
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Users</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          All {allUsers.length} registered accounts.
        </p>
      </div>

      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.6fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Email</span>
          <span>Role</span>
          <span>Identity</span>
          <span>Packages</span>
          <span>Joined</span>
          <span>Actions</span>
        </div>

        {allUsers.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No users yet.</p>
        )}

        {allUsers.map((u) => {
          const profile = profileMap.get(u.id);
          const pkgCount = pkgCountMap.get(u.id) ?? 0;
          const repTalents = repTalentMap.get(u.id) ?? 0;
          const role = (u.role ?? "talent") as Role;

          return (
            <div
              key={u.id}
              className="grid items-center px-5 py-3.5 border-b last:border-0 text-sm min-w-[800px]"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.6fr",
                borderColor: "var(--color-border)",
                opacity: u.suspendedAt ? 0.6 : 1,
              }}
            >
              {/* Email + avatar */}
              <div className="flex items-center gap-3 min-w-0">
                {profile?.profileImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.profileImageUrl}
                    alt={profile.fullName}
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
                <span className="truncate" style={{ color: "var(--color-text)" }}>{u.email}</span>
              </div>

              {/* Role badge */}
              <span
                className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                style={{ background: `${ROLE_COLOR[role]}18`, color: ROLE_COLOR[role] }}
              >
                {ROLE_LABEL[role]}
              </span>

              {/* Identity / name */}
              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                {profile?.fullName ?? (role === "talent" ? "—" : "—")}
              </span>

              {/* Packages or roster count */}
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {role === "talent" && pkgCount > 0 && pkgCount}
                {role === "rep" && repTalents > 0 && `${repTalents} talent`}
                {(pkgCount === 0 && repTalents === 0) && "—"}
              </span>

              {/* Joined date */}
              <div>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {ts(u.createdAt)}
                </span>
                {u.suspendedAt && (
                  <span
                    className="ml-2 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(107,114,128,0.12)", color: "#6b7280" }}
                  >
                    Suspended
                  </span>
                )}
                {u.aiDisabled && (
                  <span
                    className="ml-2 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(139,92,246,0.12)", color: "#8b5cf6" }}
                  >
                    AI Off
                  </span>
                )}
              </div>

              {/* Actions */}
              <UserActions
                userId={u.id}
                isSuspended={!!u.suspendedAt}
                isCurrentUser={u.id === currentUserId}
                emailMuted={!!u.emailMuted}
                aiDisabled={!!u.aiDisabled}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
