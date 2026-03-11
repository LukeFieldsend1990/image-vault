export const runtime = "edge";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { users, talentProfiles, talentSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import TalentAdminClient from "./talent-admin-client";

export default async function AdminTalentDetailPage({
  params,
}: {
  params: Promise<{ talentId: string }>;
}) {
  await requireAdmin();
  const { talentId } = await params;
  const db = getDb();

  const [talent, profile, settings] = await Promise.all([
    db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, talentId)).get(),
    db.select({ fullName: talentProfiles.fullName, profileImageUrl: talentProfiles.profileImageUrl })
      .from(talentProfiles).where(eq(talentProfiles.userId, talentId)).get(),
    db.select().from(talentSettings).where(eq(talentSettings.talentId, talentId)).get(),
  ]);

  if (!talent || talent === undefined) notFound();

  const initialSettings = {
    pipelineEnabled: settings?.pipelineEnabled ?? true,
    talentSharePct: settings?.talentSharePct ?? 65,
    agencySharePct: settings?.agencySharePct ?? 20,
    platformSharePct: settings?.platformSharePct ?? 15,
  };

  const displayName = profile?.fullName ?? talent.email;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-5 border-b flex items-center gap-4" style={{ borderColor: "var(--color-border)" }}>
        <Link
          href="/admin/talent"
          className="shrink-0 p-1 rounded transition opacity-40 hover:opacity-100"
          style={{ color: "var(--color-ink)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>

        {profile?.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.profileImageUrl}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full shrink-0 text-sm font-semibold text-white"
            style={{ background: "var(--color-ink)" }}
          >
            {talent.email[0]?.toUpperCase() ?? "?"}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}>
              Admin
            </p>
          </div>
          <h1 className="text-lg font-semibold tracking-tight truncate" style={{ color: "var(--color-ink)" }}>
            {displayName}
          </h1>
          {profile?.fullName && (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{talent.email}</p>
          )}
        </div>
      </div>

      {/* Client component handles tabs */}
      <TalentAdminClient
        talentId={talentId}
        initialSettings={initialSettings}
      />
    </div>
  );
}
