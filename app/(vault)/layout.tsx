export const runtime = "edge";

import { cookies } from "next/headers";
import { NavLinks } from "./nav";
import UserWidget from "./user-widget";
import SidebarShell from "./sidebar-shell";
import { getDb } from "@/lib/db";
import { talentProfiles, talentSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Role = "talent" | "rep" | "licensee" | "admin";

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

export default async function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sub, email, role, initials } = await getSessionData();
  const [identity, pipelineEnabled] = await Promise.all([
    role === "talent" ? getTalentIdentity(sub) : Promise.resolve(null),
    role === "talent" ? getPipelineEnabled(sub) : Promise.resolve(false),
  ]);

  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarShell>
        {/* Logo */}
        <div className="flex flex-col justify-between h-full py-8">
          <div>
            <a href="/dashboard" className="block px-6 mb-10">
              <div className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--color-sidebar-muted)" }}>
                United Agents
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="text-sm font-medium tracking-wide">
                  Image Vault
                </div>
              </div>
              <div className="mt-1.5 h-px w-6" style={{ background: "var(--color-accent)" }} />
            </a>

            <NavLinks role={role} email={email} pipelineEnabled={pipelineEnabled} />
          </div>

          <UserWidget
            email={email}
            initials={initials}
            role={role}
            identity={identity}
          />
        </div>
      </SidebarShell>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg] pt-12 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
