import { cookies } from "next/headers";
import { NavLinks } from "./nav";
import UserWidget from "./user-widget";
import SidebarShell from "./sidebar-shell";
import NotificationBell from "./notification-bell";
import { CodesProvider } from "@/app/components/code-tag";
import { getDb } from "@/lib/db";
import { licences, talentProfiles, talentReps, talentSettings, users } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { isIndustryRole, isComplianceRole } from "@/lib/auth/roles";
import { isAdmin } from "@/lib/auth/adminEmails";
import { hasPlatformGrant, hasInsurerGrant } from "@/lib/compliance/grants";

type Role = "talent" | "rep" | "industry" | "licensee" | "compliance" | "admin";

interface SessionData {
  sub: string;
  email: string;
  role: Role;
  initials: string;
}

async function getSessionData(): Promise<SessionData> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return { sub: "", email: "", role: "talent", initials: "??" };
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      email?: string;
      role?: Role;
    };
    const email = payload.email ?? "";
    const initials =
      email
        .split("@")[0]
        .split(/[._-]/)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? "")
        .join("") || "??";
    return { sub: payload.sub ?? "", email, role: payload.role ?? "talent", initials };
  } catch {
    return { sub: "", email: "", role: "talent", initials: "??" };
  }
}

export interface TalentIdentity {
  fullName: string;
  profileImageUrl: string | null;
  tmdbId: number | null;
}

async function getTalentIdentity(userId: string): Promise<TalentIdentity | null> {
  if (!userId) return null;
  try {
    const db = getDb();
    const row = await db
      .select({
        fullName: talentProfiles.fullName,
        profileImageUrl: talentProfiles.profileImageUrl,
        tmdbId: talentProfiles.tmdbId,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId))
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

async function getPipelineEnabled(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const db = getDb();
    const row = await db
      .select({ pipelineEnabled: talentSettings.pipelineEnabled })
      .from(talentSettings)
      .where(eq(talentSettings.talentId, userId))
      .get();
    return row?.pipelineEnabled ?? true;
  } catch {
    return true;
  }
}

async function getLicenceAlert(userId: string, role: Role): Promise<boolean> {
  if (!userId) return false;
  try {
    const db = getDb();
    if (isIndustryRole(role)) {
      const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(licences)
        .where(and(
          eq(licences.licenseeId, userId),
          inArray(licences.status, ["PENDING", "SCRUB_PERIOD", "OVERDUE"]),
        ))
        .get();
      return (row?.n ?? 0) > 0;
    }
    if (role === "talent") {
      const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(licences)
        .where(and(eq(licences.talentId, userId), eq(licences.status, "PENDING")))
        .get();
      return (row?.n ?? 0) > 0;
    }
    if (role === "rep") {
      const managed = await db
        .select({ talentId: talentReps.talentId })
        .from(talentReps)
        .where(eq(talentReps.repId, userId))
        .all();
      if (managed.length === 0) return false;
      const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(licences)
        .where(and(
          inArray(licences.talentId, managed.map((m) => m.talentId)),
          eq(licences.status, "PENDING"),
        ))
        .get();
      return (row?.n ?? 0) > 0;
    }
    return false;
  } catch {
    return false;
  }
}

async function getInboundEnabled(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const db = getDb();
    const row = await db
      .select({ inboundEnabled: users.inboundEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return !!row?.inboundEnabled;
  } catch {
    return false;
  }
}

async function getShowCodes(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const db = getDb();
    const row = await db
      .select({ showCodes: users.showCodes })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    return !!row?.showCodes;
  } catch {
    return false;
  }
}

// Compliance watchers see the oversight Productions tracker only with a
// platform-wide grant; admins always.
async function getPlatformOversight(userId: string, email: string, role: Role): Promise<boolean> {
  if (isAdmin(email)) return true;
  if (!isComplianceRole(role) || !userId) return false;
  try {
    return await hasPlatformGrant(getDb(), userId);
  } catch {
    return false;
  }
}

// Insurer watchers (compliance role holding an insurer grant) get the Underwriting
// surface and land there by default.
async function getInsurerWatcher(userId: string, role: Role): Promise<boolean> {
  if (!isComplianceRole(role) || !userId) return false;
  try {
    return await hasInsurerGrant(getDb(), userId);
  } catch {
    return false;
  }
}

// Reps who belong to a talent agency org get the Agency nav surface.
async function getAgencyMember(userId: string, role: Role): Promise<boolean> {
  if (role !== "rep" || !userId) return false;
  try {
    const { getAgencyMembership } = await import("@/lib/agency/membership");
    return !!(await getAgencyMembership(getDb(), userId));
  } catch {
    return false;
  }
}

async function getComplianceEnabled(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const db = getDb();
    const row = await db
      .select({ complianceEnabled: users.complianceEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    // null/undefined → default true (mirrors the check in lib/compliance/access.ts)
    return row?.complianceEnabled !== false;
  } catch {
    return true;
  }
}

export default async function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sub, email, role, initials } = await getSessionData();
  const [identity, pipelineEnabled, inboundEnabled, licenceAlert, complianceEnabled, showCodes, platformOversight, insurerWatcher, agencyMember] = await Promise.all([
    role === "talent" ? getTalentIdentity(sub) : Promise.resolve(null),
    role === "talent" ? getPipelineEnabled(sub) : Promise.resolve(false),
    getInboundEnabled(sub),
    getLicenceAlert(sub, role),
    getComplianceEnabled(sub),
    getShowCodes(sub),
    getPlatformOversight(sub, email, role),
    getInsurerWatcher(sub, role),
    getAgencyMember(sub, role),
  ]);

  const homeHref = isComplianceRole(role)
    ? (insurerWatcher && !platformOversight ? "/underwriting" : "/evidence")
    : isIndustryRole(role) ? "/productions" : role === "rep" ? "/roster" : "/dashboard";

  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarShell homeHref={homeHref}>
        {/* Logo */}
        <div className="flex flex-col justify-between h-full py-8">
          <div>
            <a href={homeHref} className="block px-6 mb-10">
              <div className="flex items-center gap-1.5">
                <div className="text-sm font-medium tracking-wide">
                  Image Vault
                </div>
              </div>
              <div className="mt-1.5 h-px w-6" style={{ background: "var(--color-accent)" }} />
            </a>

            <NavLinks role={role} email={email} pipelineEnabled={pipelineEnabled} inboundEnabled={inboundEnabled} licenceAlert={licenceAlert} complianceEnabled={complianceEnabled} platformOversight={platformOversight} insurerWatcher={insurerWatcher} agencyMember={agencyMember} />
          </div>

          <div>
            <NotificationBell />
            <UserWidget
              email={email}
              initials={initials}
              role={role}
              identity={identity}
            />
          </div>
        </div>
      </SidebarShell>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg] pt-12 lg:pt-0">
        <CodesProvider show={showCodes}>{children}</CodesProvider>
      </main>
    </div>
  );
}
