export const runtime = "edge";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users, talentReps, talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isAdmin } from "@/lib/auth/adminEmails";
import { cookies } from "next/headers";
import ComplianceClient from "./compliance-client";
import RepCompliancePicker from "./rep-compliance-picker";

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ talentId?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  let role: string | null = null;
  let userId: string | null = null;
  let email: string | null = null;

  if (sessionCookie) {
    try {
      const payload = JSON.parse(atob(sessionCookie.split(".")[1])) as {
        role?: string;
        sub?: string;
        email?: string;
      };
      role  = payload.role ?? null;
      userId = payload.sub ?? null;
      email  = payload.email ?? null;
    } catch { /* malformed JWT — will redirect below */ }
  }

  if (!userId) redirect("/login");

  // Licensees access compliance through their licence panel, not this page
  if (role === "licensee") redirect("/dashboard");

  // Admins always have access; non-admins check the DB flag
  if (!isAdmin(email ?? "")) {
    const db = getDb();
    const row = await db
      .select({ complianceEnabled: users.complianceEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (row?.complianceEnabled === false) redirect("/dashboard");
  }

  // Reps view compliance per managed talent — show a talent picker
  if (role === "rep") {
    const { talentId } = await searchParams;
    const db = getDb();

    // Fetch roster
    const roster = await db
      .select({
        talentId: talentReps.talentId,
        fullName: talentProfiles.fullName,
        profileImageUrl: talentProfiles.profileImageUrl,
      })
      .from(talentReps)
      .leftJoin(talentProfiles, eq(talentProfiles.userId, talentReps.talentId))
      .where(eq(talentReps.repId, userId))
      .all();

    if (talentId) {
      // Validate the rep manages this talent
      const ok = roster.some((r) => r.talentId === talentId);
      if (!ok) redirect("/compliance");
      return <ComplianceClient talentId={talentId} />;
    }

    // No talent selected — auto-redirect to first or show picker
    if (roster.length === 1) {
      redirect(`/compliance?talentId=${roster[0].talentId}`);
    }

    return (
      <RepCompliancePicker
        roster={roster.map((r) => ({
          talentId: r.talentId,
          fullName: r.fullName,
          profileImageUrl: r.profileImageUrl ?? null,
        }))}
      />
    );
  }

  return <ComplianceClient />;
}
